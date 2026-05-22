/**
 * MemoriX — Content Script
 * Injected into: GitHub, GitLab, VS Code Web, CodePen, JSFiddle,
 *                StackBlitz, Replit, npm, MDN, DevDocs
 *
 * Responsibilities:
 *  - Detect the host platform and adapt selectors accordingly
 *  - Extract visible code context (language, filename, snippet)
 *  - Relay context to the background service worker
 *  - Render lightweight save-confirmation overlays (no React — pure DOM)
 *
 * PRIVACY GUARANTEE:
 *  This script reads DOM content only. It never exfiltrates data externally.
 *  All data is sent exclusively to the background service worker via
 *  chrome.runtime.sendMessage, which routes to chrome.storage.local only.
 */

(function memorixContentScript() {
  "use strict";

  // Guard: prevent double-injection on SPA navigations
  if (window.__memorixInjected) return;
  window.__memorixInjected = true;

  // ─── Constants ─────────────────────────────────────────────────────────────

  const EXT_NAME = "MemoriX";

  const MSG = {
    CONTEXT_DETECTED: "CONTEXT_DETECTED",
    SNIPPET_SAVE:     "SNIPPET_SAVE",
    TRIGGER_RELATE:   "TRIGGER_RELATE",
  };

  // ─── Platform Detection ────────────────────────────────────────────────────

  const PLATFORMS = {
    GITHUB:      "github",
    GIST:        "gist",
    GITLAB:      "gitlab",
    VSCODE_WEB:  "vscode_web",
    CODEPEN:     "codepen",
    JSFIDDLE:    "jsfiddle",
    STACKBLITZ:  "stackblitz",
    REPLIT:      "replit",
    NPM:         "npm",
    MDN:         "mdn",
    DEVDOCS:     "devdocs",
    UNKNOWN:     "unknown",
  };

  function detectPlatform(hostname) {
    if (hostname.includes("github.com") && hostname.includes("gist")) return PLATFORMS.GIST;
    if (hostname.includes("github.com"))     return PLATFORMS.GITHUB;
    if (hostname.includes("gitlab.com"))     return PLATFORMS.GITLAB;
    if (hostname.includes("vscode.dev") ||
        hostname.includes("github.dev"))     return PLATFORMS.VSCODE_WEB;
    if (hostname.includes("codepen.io"))     return PLATFORMS.CODEPEN;
    if (hostname.includes("jsfiddle.net"))   return PLATFORMS.JSFIDDLE;
    if (hostname.includes("stackblitz.com")) return PLATFORMS.STACKBLITZ;
    if (hostname.includes("replit.com"))     return PLATFORMS.REPLIT;
    if (hostname.includes("npmjs.com"))      return PLATFORMS.NPM;
    if (hostname.includes("mozilla.org"))    return PLATFORMS.MDN;
    if (hostname.includes("devdocs.io"))     return PLATFORMS.DEVDOCS;
    return PLATFORMS.UNKNOWN;
  }

  const platform = detectPlatform(window.location.hostname);
  log("info", `Injected · platform=${platform} · ${window.location.href}`);

  // ─── Context Extractors ────────────────────────────────────────────────────

  /**
   * Platform-specific strategies to pull code context from the DOM.
   * Each extractor returns a ContextPayload or null.
   *
   * @typedef {{ language: string, filename: string|null, code: string, platform: string, url: string }} ContextPayload
   */
  const extractors = {

    [PLATFORMS.GITHUB]() {
      // Primary: file blob view  /blob/main/src/foo.js
      const fileHeader  = document.querySelector(".Box-header .final-path, [data-testid='breadcrumbs-filename']");
      const codeEl      = document.querySelector(".highlight code, .blob-code-inner");
      const langBadge   = document.querySelector("[data-ga-click*='language'], .repository-lang-stats-graph [data-lang]");

      if (!codeEl) return null;

      const filename  = fileHeader?.textContent?.trim() ?? extractFilenameFromURL();
      const language  = langBadge?.dataset?.lang
                      ?? inferLanguageFromFilename(filename)
                      ?? "text";
      const code      = collectText(".blob-code-inner") || codeEl.textContent.trim();

      return code ? { language, filename, code: code.slice(0, 8000), platform, url: location.href } : null;
    },

    [PLATFORMS.GIST]() {
      const codeEl   = document.querySelector(".blob-code-inner");
      const langEl   = document.querySelector(".file-header .language-name, .gist-blob .file-info em");
      const filename = document.querySelector(".gist-blob .file-header .file-info strong")?.textContent?.trim() ?? null;

      if (!codeEl) return null;
      return {
        language: langEl?.textContent?.trim() ?? "text",
        filename,
        code: collectText(".blob-code-inner").slice(0, 8000),
        platform,
        url: location.href,
      };
    },

    [PLATFORMS.GITLAB]() {
      const codeEl   = document.querySelector(".blob-content code, #blob-content-holder code");
      const filename = document.querySelector(".js-blob-filename")?.textContent?.trim()
                     ?? extractFilenameFromURL();
      if (!codeEl) return null;

      return {
        language: inferLanguageFromFilename(filename) ?? "text",
        filename,
        code: codeEl.textContent.trim().slice(0, 8000),
        platform,
        url: location.href,
      };
    },

    [PLATFORMS.VSCODE_WEB]() {
      // VS Code Web uses Monaco — read the aria-label on the editor container
      const editorEl  = document.querySelector(".monaco-editor");
      const titleEl   = document.querySelector(".tab.active .tab-label");
      const filename  = titleEl?.textContent?.trim() ?? null;
      const langEl    = document.querySelector(".editor-statusbar-item.status-bar-info");

      if (!editorEl) return null;

      // Monaco lines are rendered in .view-line elements
      const code = Array.from(document.querySelectorAll(".view-line"))
        .map((l) => l.textContent)
        .join("\n")
        .slice(0, 8000);

      return code
        ? { language: inferLanguageFromFilename(filename) ?? "text", filename, code, platform, url: location.href }
        : null;
    },

    [PLATFORMS.STACKBLITZ]() {
      const filename  = document.querySelector(".file-list .file.is-active span")?.textContent?.trim() ?? null;
      const lines     = Array.from(document.querySelectorAll(".view-line")).map((l) => l.textContent).join("\n");
      if (!lines) return null;
      return { language: inferLanguageFromFilename(filename) ?? "text", filename, code: lines.slice(0, 8000), platform, url: location.href };
    },

    [PLATFORMS.REPLIT]() {
      const filename = document.querySelector(".file-tab.selected")?.textContent?.trim() ?? null;
      const code     = Array.from(document.querySelectorAll(".cm-line")).map((l) => l.textContent).join("\n");
      if (!code) return null;
      return { language: inferLanguageFromFilename(filename) ?? "text", filename, code: code.slice(0, 8000), platform, url: location.href };
    },

    [PLATFORMS.CODEPEN]() {
      // CodePen active panel titles: "HTML", "CSS", "JS"
      const activeTab = document.querySelector(".editor-tab.active")?.textContent?.trim()?.toLowerCase();
      const code      = document.querySelector(".CodeMirror-code")?.textContent?.trim();
      if (!code) return null;
      return { language: activeTab ?? "text", filename: null, code: code.slice(0, 8000), platform, url: location.href };
    },

    [PLATFORMS.JSFIDDLE]() {
      const code = document.querySelector(".CodeMirror-code")?.textContent?.trim();
      if (!code) return null;
      return { language: "javascript", filename: null, code: code.slice(0, 8000), platform, url: location.href };
    },

    [PLATFORMS.NPM]() {
      const code = document.querySelector("#readme pre code, .markdown-body pre code")?.textContent?.trim();
      const pkg  = document.querySelector(".package-name-redundant")?.textContent?.trim() ?? extractFilenameFromURL();
      if (!code) return null;
      return { language: "javascript", filename: pkg, code: code.slice(0, 8000), platform, url: location.href };
    },

    [PLATFORMS.MDN]() {
      const code = document.querySelector("pre.brush\\:js code, pre[class*='language-'] code")?.textContent?.trim();
      const lang = document.querySelector("pre[class*='language-']")
                    ?.className?.match(/language-(\w+)/)?.[1] ?? "text";
      if (!code) return null;
      return { language: lang, filename: document.title, code: code.slice(0, 8000), platform, url: location.href };
    },

    [PLATFORMS.DEVDOCS]() {
      const code = document.querySelector("pre code")?.textContent?.trim();
      if (!code) return null;
      return { language: "text", filename: document.title, code: code.slice(0, 8000), platform, url: location.href };
    },

    [PLATFORMS.UNKNOWN]: () => null,
  };

  // ─── Language Inference ────────────────────────────────────────────────────

  const EXT_LANG_MAP = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    cs: "csharp", cpp: "cpp", c: "c", php: "php", swift: "swift",
    kt: "kotlin", sh: "bash", bash: "bash", zsh: "bash",
    html: "html", htm: "html", css: "css", scss: "scss", sass: "scss",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    md: "markdown", sql: "sql", graphql: "graphql", tf: "terraform",
    dockerfile: "docker",
  };

  function inferLanguageFromFilename(filename) {
    if (!filename) return null;
    const ext = filename.split(".").pop()?.toLowerCase();
    return EXT_LANG_MAP[ext] ?? null;
  }

  function extractFilenameFromURL() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? null;
  }

  function collectText(selector) {
    return Array.from(document.querySelectorAll(selector))
      .map((el) => el.textContent)
      .join("\n");
  }

  // ─── Context Detection & Dispatch ─────────────────────────────────────────

  async function detectAndReportContext() {
    const extractor = extractors[platform];
    if (!extractor) return;

    const context = extractor();
    if (!context) {
      log("debug", "No code context detected on this page");
      return;
    }

    log("info", `Context detected · lang=${context.language} · ${context.code.length} chars`);
    await sendToBackground({ action: MSG.CONTEXT_DETECTED, payload: context });
  }

  // ─── Message Listener (from background / popup) ────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const { action, payload } = message ?? {};

    (async () => {
      switch (action) {
        case MSG.SNIPPET_SAVE: {
          log("info", "Snippet save requested via context menu");
          showSaveConfirmation(payload?.text ?? "");
          sendResponse({ ok: true });
          break;
        }

        case MSG.TRIGGER_RELATE: {
          log("info", "Relate triggered via context menu / shortcut");
          await detectAndReportContext();
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: `Unknown action: ${action}` });
      }
    })();

    return true;
  });

  // ─── Save Confirmation Overlay ─────────────────────────────────────────────

  let overlayTimeout = null;

  function showSaveConfirmation(previewText) {
    // Remove any existing overlay
    document.getElementById("memorix-toast")?.remove();
    clearTimeout(overlayTimeout);

    const toast = document.createElement("div");
    toast.id = "memorix-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
      <span style="color:#6ee7b7;font-size:14px;">✦</span>
      <span><strong style="color:#ecfdf5;">MemoriX</strong>
        &nbsp;Snippet saved to scratchpad</span>
    `;

    // Inline styles — avoids any host-page CSS conflicts
    Object.assign(toast.style, {
      position:      "fixed",
      bottom:        "24px",
      right:         "24px",
      zIndex:        "2147483647",
      display:       "flex",
      alignItems:    "center",
      gap:           "10px",
      background:    "rgba(6,20,15,0.92)",
      border:        "1px solid rgba(110,231,183,0.3)",
      borderRadius:  "10px",
      padding:       "12px 18px",
      fontFamily:    "'JetBrains Mono', 'Fira Code', monospace",
      fontSize:      "13px",
      color:         "#a7f3d0",
      backdropFilter:"blur(12px)",
      boxShadow:     "0 8px 32px rgba(0,0,0,0.5)",
      animation:     "memorix-slide-up 0.3s cubic-bezier(0.16,1,0.3,1) forwards",
      cursor:        "pointer",
    });

    // Inject keyframe animation once
    if (!document.getElementById("memorix-styles")) {
      const style = document.createElement("style");
      style.id = "memorix-styles";
      style.textContent = `
        @keyframes memorix-slide-up {
          from { opacity:0; transform: translateY(12px); }
          to   { opacity:1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    toast.addEventListener("click", () => toast.remove());
    document.body.appendChild(toast);

    overlayTimeout = setTimeout(() => toast.remove(), 3500);
  }

  // ─── SPA Navigation Observer ───────────────────────────────────────────────

  /**
   * GitHub, GitLab and VS Code Web are SPAs — pushState navigations don't
   * re-inject content scripts. We observe URL changes and re-run detection.
   */
  let lastUrl = location.href;

  const navObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      log("debug", `SPA navigation detected → ${lastUrl}`);
      // Small delay for the new page DOM to settle
      setTimeout(detectAndReportContext, 800);
    }
  });

  navObserver.observe(document.body, { childList: true, subtree: true });

  // ─── Utilities ─────────────────────────────────────────────────────────────

  async function sendToBackground(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      // Extension context may be invalidated after an update — safe to ignore
      if (!err.message?.includes("Extension context invalidated")) {
        log("error", "sendToBackground failed", err);
      }
    }
  }

  function log(level, message, ...args) {
    const isDev = !("update_url" in chrome.runtime.getManifest());
    if (!isDev && (level === "debug" || level === "info")) return;
    const prefix = `[${EXT_NAME}][CS]`;
    console[level === "error" ? "error" : level === "warn" ? "warn" : "info"](
      `${prefix} ${message}`, ...args
    );
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  // Run initial detection after DOM is stable
  if (document.readyState === "complete") {
    detectAndReportContext();
  } else {
    window.addEventListener("load", detectAndReportContext, { once: true });
  }

})();
