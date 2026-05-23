/**
 * MemoriX Popup Integration Guide
 *
 * This file provides step-by-step integration instructions for wiring
 * the new RelatePanel, VectorIndex, and StorageEngine into popup.js
 *
 * Key Integration Points:
 * 1. Import RelatePanel and styles
 * 2. Create message listener for EMBEDDINGS_COMPUTED
 * 3. Add "Relate" button to SnippetCard
 * 4. Implement relate click handler
 * 5. Fetch related snippets and render RelatePanel
 */

// ─── INTEGRATION INSTRUCTIONS ─────────────────────────────────────────────────

/*
 * STEP 1: Update popup.js imports
 * ─────────────────────────────────
 * Add these imports at the top of popup.js:
 *
 * import { RelatePanel, relatePanelStyles } from './components/RelatePanel.js';
 * import { vectorIndex } from '../core/vectorIndex.js';
 * import { storage } from '../core/storage-v2.js';
 */

/*
 * STEP 2: Add RelatePanel container to popup.html
 * ────────────────────────────────────────────────
 * Add this div to popup.html after the snippet list:
 *
 * <div id="relate-panel-container"></div>
 *
 * Add styles to a <style> tag:
 * <style>
 * [insert content from relatePanelStyles here]
 * </style>
 */

/*
 * STEP 3: Update state to track relate UI
 * ────────────────────────────────────────
 * Add to state object in popup.js:
 *
 * relatePanelVisible: false,
 * relateMatches: [],
 * selectedSnippetForRelate: null,
 */

/*
 * STEP 4: Add event listener for vector computation updates
 * ──────────────────────────────────────────────────────────
 * Add to popup.js initialization:
 *
 * chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
 *   if (message.type === 'EMBEDDINGS_COMPUTED') {
 *     console.log('[Popup] Vector computation complete:', message.count);
 *     // Refresh related snippets if relate panel is open
 *     if (state.relatePanelVisible && state.selectedSnippetForRelate) {
 *       refreshRelateResults(state.selectedSnippetForRelate);
 *     }
 *   }
 * });
 */

/*
 * STEP 5: Add Relate button to SnippetCard rendering
 * ───────────────────────────────────────────────────
 * In the renderSnippetList() function, update the snippet card HTML:
 *
 * <button 
 *   class="snippet-relate-btn" 
 *   data-uuid="${snippet.uuid}"
 *   title="Find similar snippets">
 *   🧲 Relate
 * </button>
 */

/*
 * STEP 6: Add relate click handler
 * ────────────────────────────────
 * In the renderSnippetList() function, add event listener:
 *
 * document.querySelectorAll('.snippet-relate-btn').forEach((btn) => {
 *   btn.addEventListener('click', (e) => {
 *     e.stopPropagation();
 *     const uuid = btn.dataset.uuid;
 *     handleRelateClick(uuid);
 *   });
 * });
 */

/*
 * STEP 7: Implement the relate handler
 * ────────────────────────────────────
 * Add this function to popup.js:
 */

// async function handleRelateClick(snippetId) {
//   try {
//     const snippets = await storage.getAllSnippets();
//     const targetSnippet = snippets.find((s) => s.uuid === snippetId);
//
//     if (!targetSnippet) return;
//
//     // Ensure vector model is initialized
//     if (!vectorIndex.modelReady) {
//       console.log('[Popup] Initializing vector model...');
//       await vectorIndex.init();
//     }
//
//     // Compute embedding for target snippet
//     console.log('[Popup] Computing embedding...');
//     const embedding = await vectorIndex.computeEmbedding(targetSnippet.code);
//
//     // Get all snippets with their embeddings
//     const allSnippets = await storage.getAllSnippets();
//     const snippetsWithEmbeddings = await Promise.all(
//       allSnippets.map(async (s) => ({
//         ...s,
//         embedding: await storage.getEmbedding(s.uuid) || [],
//       }))
//     );
//
//     // Find similar snippets
//     const matches = vectorIndex.findSimilar(embedding, snippetsWithEmbeddings, 5)
//       .filter((m) => m.uuid !== snippetId); // Exclude self
//
//     // Render relate panel
//     const panel = new RelatePanel(document.getElementById('relate-panel-container'));
//     panel.render(matches);
//
//     setState({
//       relatePanelVisible: true,
//       relateMatches: matches,
//       selectedSnippetForRelate: snippetId,
//     });
//   } catch (error) {
//     console.error('[Popup] Relate failed:', error);
//     showToast('Failed to find related snippets', 'error');
//   }
// }

/*
 * STEP 8: Add CSS for relate button to popup.html
 * ────────────────────────────────────────────────
 * Add to the <style> section:
 *
 * .snippet-relate-btn {
 *   background: rgba(45, 255, 154, 0.1);
 *   border: 1px solid var(--accent);
 *   color: var(--accent);
 *   padding: 4px 8px;
 *   border-radius: 3px;
 *   cursor: pointer;
 *   font-size: 11px;
 *   font-weight: 600;
 *   transition: all 0.2s;
 * }
 *
 * .snippet-relate-btn:hover {
 *   background: rgba(45, 255, 154, 0.2);
 *   transform: translateY(-1px);
 * }
 */

/*
 * STEP 9: Handle close button
 * ───────────────────────────
 * The RelatePanel already has a close button that hides itself.
 * You can also close it programmatically:
 *
 * function closeRelatePanel() {
 *   const container = document.getElementById('relate-panel-container');
 *   container.innerHTML = '';
 *   setState({
 *     relatePanelVisible: false,
 *     relateMatches: [],
 *   });
 * }
 */

/*
 * STEP 10: Handle keyboard shortcut
 * ──────────────────────────────────
 * Add to popup.js keyboard handling:
 *
 * document.addEventListener('keydown', (e) => {
 *   if (e.key === 'Escape' && state.relatePanelVisible) {
 *     closeRelatePanel();
 *   }
 * });
 */

// ─── ARCHITECTURE FLOW ─────────────────────────────────────────────────────────

/*
 * User clicks "Relate" on a snippet:
 *
 * 1. popup.js calls handleRelateClick(snippetId)
 * 2. vectorIndex.init() loads Transformers.js + model (one-time, background)
 * 3. vectorIndex.computeEmbedding(code) → sends to SharedWorker
 * 4. SharedWorker computes 384-dim vector (non-blocking)
 * 5. vectorIndex.findSimilar() → runs cosine similarity search
 * 6. RelatePanel renders top-5 matches with scores
 * 7. User can copy/use matched snippets
 *
 * Background (automatic):
 * - vectorQueueOrchestrator polls every 5 seconds for pending tasks
 * - When new snippet is saved, it's automatically queued for embedding
 * - Background worker computes embedding in parallel
 * - Results saved to IndexedDB for instant relate searches
 */

// ─── TESTING CHECKLIST ─────────────────────────────────────────────────────────

/*
 * After implementing, test:
 *
 * ✓ Save a snippet (should be queued for embedding)
 * ✓ Check IndexedDB (snippet should exist)
 * ✓ Wait 5-10 seconds for vector computation
 * ✓ Check background console (vectorQueueOrchestrator logs)
 * ✓ Click "Relate" on a snippet
 * ✓ Model downloads (~50MB, cached locally)
 * ✓ Related snippets appear with similarity scores
 * ✓ Copy button works
 * ✓ Use button injects snippet to page
 * ✓ Close button hides panel
 */

export const POPUP_INTEGRATION_GUIDE = {
  description: 'Integration guide for RelatePanel + VectorIndex in popup.js',
  steps: 10,
  estimatedTime: '30-45 minutes',
  difficulty: 'Medium',
};
