/**
 * MemoriX Service Worker
 * 
 * Manifest V3 background service worker.
 * Handles:
 * - Extension events (install, update)
 * - Context menu integration (future)
 * - Message relay between content scripts and popup
 * - Analytics and telemetry (future)
 */

"use strict";

console.log("[MemoriX] Service Worker Started");

/**
 * Extension installed or updated
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("[MemoriX] Extension installed!");
    // Open welcome page or onboarding (future)
  } else if (details.reason === "update") {
    console.log("[MemoriX] Extension updated");
  }
});

/**
 * Listen for messages from content scripts or popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[MemoriX] Service Worker received message:", request.action, "from", sender.tab?.url);

  if (request.action === "SNIPPET_SAVE") {
    // Called when a snippet is saved from the popup
    // Future: send to analytics, backup, sync
    console.log("[MemoriX] Snippet saved:", request.payload);
    sendResponse({ status: "ok" });
    return true;
  }

  if (request.action === "GET_PAGE_CONTEXT") {
    // Forward request to content script
    chrome.tabs.sendMessage(sender.tab.id, { action: "getPageContext" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[MemoriX] Error getting page context:", chrome.runtime.lastError);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response);
      }
    });
    return true; // Keep channel open for async response
  }

  return false;
});

/**
 * Context menu integration (future feature)
 */
// chrome.runtime.onInstalled.addListener(() => {
//   chrome.contextMenus.create({
//     id: "memorix-save-snippet",
//     title: "Save to MemoriX",
//     contexts: ["selection", "link"],
//   });
// });

// chrome.contextMenus.onClicked.addListener((info, tab) => {
//   if (info.menuItemId === "memorix-save-snippet") {
//     console.log("[MemoriX] Context menu: save snippet");
//   }
// });

/**
 * Badge text and color
 */
chrome.action.setBadgeBackgroundColor({ color: "#2dff9a" });
chrome.action.setBadgeTextColor({ color: "#000" });

console.log("[MemoriX] Service Worker Ready");
