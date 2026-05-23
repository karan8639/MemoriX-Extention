/**
 * MemoriX — Vector Queue Orchestrator
 *
 * Background task manager that processes embeddings asynchronously.
 *
 * Responsibilities:
 *  - Poll for pending vector computation tasks
 *  - Delegate to VectorIndex worker
 *  - Handle task retry and failure
 *  - Update StorageEngine with computed embeddings
 *  - Broadcast progress updates to popup/sidepanel
 */

import { storage } from './storage-v2.js';
import { vectorIndex } from './vectorIndex.js';

export class VectorQueueOrchestrator {
  constructor() {
    this.isRunning = false;
    this.pollingInterval = 5000; // check every 5 seconds
    this.maxRetries = 3;
    this.batchSize = 10;
  }

  /**
   * Start the orchestrator background loop.
   * Safe to call multiple times (idempotent).
   */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log('[VectorQueueOrchestrator] Started');

    // Initial poll
    this._pollAndProcess();

    // Recurring poll
    this.pollTimer = setInterval(() => {
      this._pollAndProcess();
    }, this.pollingInterval);
  }

  /**
   * Stop the orchestrator.
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    clearInterval(this.pollTimer);
    console.log('[VectorQueueOrchestrator] Stopped');
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  async _pollAndProcess() {
    try {
      const pendingTasks = await storage.getPendingComputations();

      if (pendingTasks.length === 0) return;

      console.log(`[VectorQueueOrchestrator] Found ${pendingTasks.length} pending tasks`);

      // Process in batches
      for (let i = 0; i < pendingTasks.length; i += this.batchSize) {
        const batch = pendingTasks.slice(i, i + this.batchSize);
        await this._processBatch(batch);
      }
    } catch (error) {
      console.error('[VectorQueueOrchestrator] Poll error:', error);
    }
  }

  async _processBatch(tasks) {
    try {
      // Fetch full snippet data for these tasks
      const snippets = await storage.getAllSnippets();
      const snippetsById = new Map(snippets.map((s) => [s.uuid, s]));

      const toComputeSnippets = [];
      const taskMap = new Map(); // uuid → taskId

      for (const task of tasks) {
        const snippet = snippetsById.get(task.snippetId);
        if (snippet) {
          toComputeSnippets.push(snippet);
          taskMap.set(snippet.uuid, task.id);
        }
      }

      if (toComputeSnippets.length === 0) return;

      // Compute embeddings
      console.log(
        `[VectorQueueOrchestrator] Computing embeddings for ${toComputeSnippets.length} snippets...`
      );

      const embeddings = await vectorIndex.batchComputeEmbeddings(
        toComputeSnippets.map((s) => ({
          id: s.uuid,
          code: s.code,
        }))
      );

      // Save embeddings and mark tasks complete
      for (const [uuid, embedding] of Object.entries(embeddings)) {
        if (embedding) {
          await storage.saveEmbedding(uuid, embedding);
          await storage.completeComputationTask(taskMap.get(uuid));
          console.log(`[VectorQueueOrchestrator] Saved embedding for ${uuid}`);
        }
      }

      // Broadcast update
      this._broadcastUpdate({
        type: 'EMBEDDINGS_COMPUTED',
        count: Object.values(embeddings).filter(Boolean).length,
      });
    } catch (error) {
      console.error('[VectorQueueOrchestrator] Batch processing error:', error);
      // Retry logic would go here
    }
  }

  _broadcastUpdate(message) {
    // Send to all tabs that might have popup/sidepanel open
    chrome.runtime.sendMessage(message).catch(() => {
      // Ignore if no listener
    });
  }
}

// ─── Export Singleton ─────────────────────────────────────────────────────────

export const vectorQueueOrchestrator = new VectorQueueOrchestrator();
