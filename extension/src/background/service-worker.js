/**
 * MemoriX — Background Service Worker
 * Manifest V3 · module type
 *
 * Responsibilities:
 *  - Extension lifecycle management (install / update / startup)
 *  - Context menu registration
 *  - Keyboard command routing
 *  - Message broker between content scripts ↔ popup / sidepanel
 *  - Alarm scheduling for deferred index maintenance
 *
 * PRIVACY GUARANTEE:
 *  This worker makes zero external network requests.
 *  All data operations route through chrome.storage.local only.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const EXT_NAME    = "MemoriX";
const EXT_VERSION = chrome.runtime.getManifest().version;

/** Message action identifiers — keep in sync with content-script.js & popup */
export const MSG = {
  // Content script → background
  CONTEXT_DETECTED:  "CONTEXT_DETECTED",   // code context found on active page
  SNIPPET_SAVE:      "SNIPPET_SAVE",        // user triggered save from content UI

  // Popup / sidepanel → background
  GET_PAGE_CONTEXT:  "GET_PAGE_CONTEXT",   // request latest context for active tab
  TRIGGER_RELATE:    "TRIGGER_RELATE",     // initiate One-Click Relate for current tab

  // Background → popup / sidepanel
  CONTEXT_READY:     "CONTEXT_READY",      // context payload delivered to UI
  RELATE_RESULTS:    "RELATE_RESULTS",     // similarity matches ready
};

/** chrome.storage.local keys */
export const STORAGE_KEY = {
  SNIPPETS:          "mx_snippets",
  KEYWORD_INDEX:     "mx_keyword_index",
  SETTINGS:          "mx_settings",
  LAST_CONTEXT:      "mx_last_context",
};

/** Context-menu item IDs */
const MENU = {
  SAVE_SELECTION:    "mx_save_selection",
  RELATE_PAGE:       "mx_relate_page",
  SEPARATOR:         "mx_sep_1",
};

// ─── Lifecycle: Install ───────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  log("info", `onInstalled · reason=${reason} · prev=${previousVersion ?? "—"} · v${EXT_VERSION}`);

  if (reason === "install") {
    await handleFreshInstall();
  }

  if (reason === "update") {
    await handleUpdate(previousVersion);
  }

  await registerContextMenus();
  await scheduleMaintenanceAlarm();
});

// ─── Lifecycle: Startup ───────────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  log("info", `onStartup · browser launched · v${EXT_VERSION}`);
  // Context menus persist across updates but not across browser profiles
  // Re-register defensively on every startup
  await registerContextMenus();
});

// ─── Install Handlers ─────────────────────────────────────────────────────────

async function handleFreshInstall() {
  log("info", "Fresh install — seeding default settings");

  const defaultSettings = {
    version:          EXT_VERSION,
    installedAt:      Date.now(),
    categorizeAuto:   true,          // auto-categorize snippets on save
    relateEngine:     "keyword",     // "keyword" | "embedding" (embedding lazy-loaded)
    maxSnippets:      500,           // local storage guard
    keyboardShortcut: true,
    onboardingDone:   false,
  };

  await chrome.storage.local.set({
    [STORAGE_KEY.SETTINGS]:      defaultSettings,
    [STORAGE_KEY.SNIPPETS]:      [],
    [STORAGE_KEY.KEYWORD_INDEX]: {},
  });

  log("info", "Default settings written to chrome.storage.local");

  // Open onboarding tab on first install
  chrome.tabs.create({ url: "https://memorix.dev/welcome?ref=extension" });
}

async function handleUpdate(previousVersion) {
  log("info", `Update from v${previousVersion} → v${EXT_VERSION}`);

  // TODO: add schema migration logic per version bump
  // Example pattern:
  // if (semverLt(previousVersion, "0.2.0")) await migrate_0_1_to_0_2();

  const settings = await getStorage(STORAGE_KEY.SETTINGS) ?? {};
  await chrome.storage.local.set({
    [STORAGE_KEY.SETTINGS]: { ...settings, version: EXT_VERSION },
  });
}

// ─── Context Menus ────────────────────────────────────────────────────────────

async function registerContextMenus() {
  // Clear stale items from previous versions before re-registering
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id:       MENU.SAVE_SELECTION,
    title:    "💾  Save to MemoriX Scratchpad",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id:       MENU.SEPARATOR,
    type:     "separator",
    contexts: ["selection", "page"],
  });

  chrome.contextMenus.create({
    id:       MENU.RELATE_PAGE,
    title:    "🔗  Find related projects (MemoriX)",
    contexts: ["page"],
  });

  log("info", "Context menus registered");
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case MENU.SAVE_SELECTION: {
      const selectedText = info.selectionText?.trim();
      if (!selectedText) return;
      log("debug", `Context menu → SAVE_SELECTION · ${selectedText.length} chars`);

      // Forward to content script for UI confirmation overlay
      await sendToTab(tab.id, {
        action:  MSG.SNIPPET_SAVE,
        payload: { text: selectedText, sourceUrl: tab.url, sourceTitle: tab.title },
      });
      break;
    }

    case MENU.RELATE_PAGE: {
      log("debug", "Context menu → RELATE_PAGE");
      await sendToTab(tab.id, { action: MSG.TRIGGER_RELATE, payload: {} });
      break;
    }
  }
});

// ─── Keyboard Commands ────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command, tab) => {
  log("debug", `Command received · ${command}`);

  switch (command) {
    case "open-scratchpad":
      // Popup opens automatically from the manifest action binding.
      // This handler is a hook for future programmatic side-panel opening.
      log("info", "Shortcut: open-scratchpad triggered");
      break;

    case "trigger-relate":
      if (tab?.id) {
        await sendToTab(tab.id, { action: MSG.TRIGGER_RELATE, payload: {} });
      }
      break;
  }
});

// ─── Message Broker ───────────────────────────────────────────────────────────

/**
 * Central message dispatcher.
 * All inter-component communication routes through here.
 *
 * sendResponse must be called synchronously OR the handler must return `true`
 * to keep the message channel alive for async responses.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message ?? {};

  if (!action) {
    log("warn", "Received message with no action field — ignored");
    return false;
  }

  log("debug", `Message in · action=${action} · tabId=${sender.tab?.id ?? "popup"}`);

  // Route to async handler; return true to keep channel open
  handleMessage(action, payload, sender)
    .then(sendResponse)
    .catch((err) => {
      log("error", `Message handler failed · action=${action}`, err);
      sendResponse({ ok: false, error: err.message });
    });

  return true; // ← Required: tells Chrome to keep the message channel open
});

async function handleMessage(action, payload, sender) {
  switch (action) {

    case MSG.CONTEXT_DETECTED: {
      // Content script found code context — cache it for the popup to read
      const tabId = sender.tab?.id;
      if (!tabId) return { ok: false, error: "No tab ID in sender" };

      await chrome.storage.local.set({
        [`${STORAGE_KEY.LAST_CONTEXT}_${tabId}`]: {
          ...payload,
          tabId,
          capturedAt: Date.now(),
        },
      });
      log("info", `Context cached for tab ${tabId} · lang=${payload?.language ?? "?"}`);
      return { ok: true };
    }

    case MSG.GET_PAGE_CONTEXT: {
      // Popup requests the latest cached context for the given tab
      const { tabId } = payload ?? {};
      const context = await getStorage(`${STORAGE_KEY.LAST_CONTEXT}_${tabId}`);
      return { ok: true, context: context ?? null };
    }

    case MSG.SNIPPET_SAVE: {
      log("info", "SNIPPET_SAVE received — routing to storage layer");
      // TODO: delegate to core/storage.js saveSnippet() once implemented
      return { ok: true, status: "queued" };
    }

    case MSG.TRIGGER_RELATE: {
      log("info", "TRIGGER_RELATE received — routing to relate engine");
      // TODO: delegate to core/relate.js once implemented
      return { ok: true, status: "queued" };
    }

    default:
      log("warn", `Unhandled action: ${action}`);
      return { ok: false, error: `Unknown action: ${action}` };
  }
}

// ─── Alarms: Maintenance ──────────────────────────────────────────────────────

const ALARM_INDEX_MAINTENANCE = "mx_index_maintenance";

async function scheduleMaintenanceAlarm() {
  await chrome.alarms.clear(ALARM_INDEX_MAINTENANCE);
  chrome.alarms.create(ALARM_INDEX_MAINTENANCE, {
    delayInMinutes:  60,     // first run 1 hour after install/startup
    periodInMinutes: 1440,   // repeat every 24 hours
  });
  log("info", "Maintenance alarm scheduled (24h interval)");
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_INDEX_MAINTENANCE) {
    log("info", "Maintenance alarm fired — pruning stale per-tab context keys");
    await pruneStaleTabContexts();
  }
});

/**
 * Remove cached tab contexts older than 48 hours to prevent storage bloat.
 * chrome.storage.local has a 10MB quota — context entries are small but
 * accumulate across many browsing sessions.
 */
async function pruneStaleTabContexts() {
  const all = await chrome.storage.local.get(null);
  const cutoff = Date.now() - 48 * 60 * 60 * 1000; // 48h

  const staleKeys = Object.entries(all)
    .filter(([key, val]) =>
      key.startsWith(STORAGE_KEY.LAST_CONTEXT) &&
      val?.capturedAt < cutoff
    )
    .map(([key]) => key);

  if (staleKeys.length) {
    await chrome.storage.local.remove(staleKeys);
    log("info", `Pruned ${staleKeys.length} stale tab context(s)`);
  } else {
    log("info", "Maintenance: no stale contexts to prune");
  }
}

// ─── Tab Cleanup ──────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Eagerly clean up context for closed tabs rather than waiting for alarm
  const key = `${STORAGE_KEY.LAST_CONTEXT}_${tabId}`;
  await chrome.storage.local.remove(key);
  log("debug", `Tab ${tabId} closed — context entry removed`);
});

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Safely send a message to a content script running in a specific tab.
 * Swallows the "no receiving end" error that fires if the content script
 * hasn't loaded yet (e.g., on chrome:// pages).
 */
async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    if (!err.message?.includes("Receiving end does not exist")) {
      log("error", `sendToTab(${tabId}) failed`, err);
    }
  }
}

/**
 * Typed wrapper around chrome.storage.local.get for a single key.
 * @template T
 * @param {string} key
 * @returns {Promise<T | null>}
 */
async function getStorage(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

// ─── Logger ───────────────────────────────────────────────────────────────────

/**
 * Structured console logger.
 * In production builds (NODE_ENV=production) only warnings and errors emit.
 *
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} message
 * @param {...any} args
 */
function log(level, message, ...args) {
  const IS_DEV = !("update_url" in chrome.runtime.getManifest()); // true in unpacked
  if (!IS_DEV && (level === "debug" || level === "info")) return;

  const prefix = `[${EXT_NAME}][SW]`;
  const ts     = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

  switch (level) {
    case "debug": console.debug(`${prefix}[${ts}] ${message}`, ...args); break;
    case "info":  console.info (`${prefix}[${ts}] ${message}`, ...args); break;
    case "warn":  console.warn (`${prefix}[${ts}] ${message}`, ...args); break;
    case "error": console.error(`${prefix}[${ts}] ${message}`, ...args); break;
  }
}

// ─── Init Confirmation ────────────────────────────────────────────────────────

log("info", `Service worker script evaluated — v${EXT_VERSION} · ${new Date().toISOString()}`);
