/**
 * MemoriX — Vector Index Engine
 *
 * Manages semantic search via embeddings.
 *
 * Features:
 *  - Lazy loading of Transformers.js (loaded only when needed)
 *  - Background Web Worker for non-blocking computation
 *  - Local model caching (~50MB, downloaded once)
 *  - Batch processing support
 *  - Cosine similarity search
 *
 * Privacy: 100% local computation, zero network calls for embeddings.
 */

export class VectorIndex {
  constructor() {
    this.worker = null;
    this.modelReady = false;
    this.pendingTasks = new Map(); // taskId → Promise resolve/reject
    this.taskIdCounter = 0;
    this.isInitializing = false;
  }

  /**
   * Initialize the vector computation worker.
   * Called lazily when user first clicks "Relate".
   *
   * @returns {Promise<void>}
   */
  async init() {
    if (this.modelReady || this.isInitializing) return;

    this.isInitializing = true;

    try {
      // Create worker from service worker script
      this.worker = new SharedWorker(
        chrome.runtime.getURL('background/vector-worker.js'),
        'vectorWorker'
      );

      // Set up message channel
      this.worker.port.onmessage = (event) => this._handleWorkerMessage(event);
      this.worker.port.onerror = (error) => {
        console.error('[VectorIndex] Worker error:', error);
        this.modelReady = false;
      };

      // Start the worker
      this.worker.port.start();

      // Send init command
      const initPromise = this._sendToWorker({
        type: 'INIT',
      });

      // Wait for model to be ready (with timeout)
      await Promise.race([
        initPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Worker init timeout')), 30000)
        ),
      ]);

      this.modelReady = true;
      console.log('[VectorIndex] Model initialized');
    } catch (e) {
      console.error('[VectorIndex] Initialization failed:', e);
      this.modelReady = false;
      throw e;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Compute embedding for a code snippet.
   * Delegates to worker for non-blocking computation.
   *
   * @param {string} code
   * @returns {Promise<number[]>} 384-dim vector
   */
  async computeEmbedding(code) {
    if (!this.modelReady) {
      await this.init();
    }

    return this._sendToWorker({
      type: 'EMBED',
      payload: { code },
    });
  }

  /**
   * Batch compute embeddings for multiple snippets.
   * Worker will process them serially with progress updates.
   *
   * @param {Array<{id: string, code: string}>} snippets
   * @returns {Promise<Map<string, number[]>>} id → embedding
   */
  async batchComputeEmbeddings(snippets) {
    if (!this.modelReady) {
      await this.init();
    }

    return this._sendToWorker({
      type: 'BATCH_EMBED',
      payload: { snippets },
    });
  }

  /**
   * Find similar snippets by embedding similarity.
   * Runs cosine similarity search in StorageEngine's IndexedDB.
   *
   * @param {number[]} queryEmbedding
   * @param {Object[]} candidates - snippet records with embeddings
   * @param {number} topK - return top K results
   * @returns {Array<{uuid: string, score: number}>}
   */
  findSimilar(queryEmbedding, candidates, topK = 5) {
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return [];
    }

    const similarities = candidates.map((candidate) => ({
      uuid: candidate.uuid,
      title: candidate.title,
      code: candidate.code,
      tags: candidate.tags,
      score: this._cosineSimilarity(queryEmbedding, candidate.embedding),
    }));

    return similarities
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Check if embeddings are available for a snippet set.
   *
   * @param {Object[]} snippets
   * @returns {Object[]} snippets with embedding status
   */
  checkEmbeddingStatus(snippets) {
    return snippets.map((s) => ({
      ...s,
      hasEmbedding: Array.isArray(s.embedding) && s.embedding.length > 0,
    }));
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  _sendToWorker(message) {
    return new Promise((resolve, reject) => {
      const taskId = ++this.taskIdCounter;
      message.taskId = taskId;

      this.pendingTasks.set(taskId, { resolve, reject });

      try {
        this.worker.port.postMessage(message);
      } catch (e) {
        this.pendingTasks.delete(taskId);
        reject(e);
      }

      // Timeout after 60 seconds
      setTimeout(() => {
        if (this.pendingTasks.has(taskId)) {
          this.pendingTasks.delete(taskId);
          reject(new Error('Vector computation timeout'));
        }
      }, 60000);
    });
  }

  _handleWorkerMessage(event) {
    const { taskId, type, payload, error } = event.data;

    const task = this.pendingTasks.get(taskId);
    if (!task) return;

    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(payload);
    }

    this.pendingTasks.delete(taskId);
  }

  _cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB) + 1e-8;
    return dotProduct / denominator;
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const vectorIndex = new VectorIndex();
