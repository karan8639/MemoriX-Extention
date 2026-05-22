/**
 * MemoriX Content Script
 * 
 * Injected into web pages matching the manifest patterns.
 * Reads page context and communicates with popup via chrome.runtime.
 */

"use strict";

console.log("[MemoriX] Content script loaded on:", window.location.hostname);

/**
 * Listen for messages from the background worker or popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageContext") {
    // Extract meaningful page context for snippet matching
    const pageText = document.body.innerText || document.body.textContent || "";
    const pageTitle = document.title || "";
    const pageUrl = window.location.href;
    
    sendResponse({
      context: pageText.substring(0, 1000),
      title: pageTitle,
      url: pageUrl,
      timestamp: Date.now(),
    });
    return true;
  }

  if (request.action === "highlightCode") {
    // Future: highlight code blocks matching a snippet
    console.log("[MemoriX] Highlight request:", request.payload);
    sendResponse({ status: "ok" });
    return true;
  }

  return false;
});

/**
 * Detect code blocks and inject UI hints (future feature)
 */
function scanForCodeBlocks() {
  const codeElements = document.querySelectorAll("pre, code, .code-block, [class*='code']");
  console.log(`[MemoriX] Found ${codeElements.length} potential code blocks`);
}

// Scan page on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scanForCodeBlocks);
} else {
  scanForCodeBlocks();
}
