/**
 * MemoriX Side Panel Script
 * 
 * Runs in the Chrome side panel alongside your active tab.
 * Shows related snippets and project context.
 */

"use strict";

console.log("[MemoriX] Side Panel Loaded");

/**
 * Listen for messages from content scripts or background worker
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateContext") {
    // Update side panel with new page context
    console.log("[MemoriX] Context updated:", request.payload);
    displayRelatedSnippets(request.payload);
    sendResponse({ status: "ok" });
    return true;
  }
  return false;
});

/**
 * Display related snippets based on page context
 */
function displayRelatedSnippets(context) {
  console.log("[MemoriX] Displaying related snippets for context:", context);
  // Future: implement fuzzy matching and display logic
}

/**
 * Get active tab and request its context
 */
async function loadPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: "getPageContext" }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("[MemoriX] Content script not available on this tab");
        } else if (response) {
          console.log("[MemoriX] Got page context:", response);
        }
      });
    }
  } catch (err) {
    console.error("[MemoriX] Error loading page context:", err);
  }
}

// Load context when side panel opens
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadPageContext);
} else {
  loadPageContext();
}
