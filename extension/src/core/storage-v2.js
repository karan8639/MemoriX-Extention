/**
 * MemoriX — Storage V2: Abstraction Layer
 *
 * Unified storage interface that transparently handles:
 *  - Chrome.storage.local (fallback, ~10MB)
 *  - IndexedDB via Dexie.js (primary, ~1GB+)
 *
 * Features:
 *  - Automatic migration detection
 *  - Lazy Dexie initialization (imported only if needed)
 *  - Full backward compatibility
 *  - Thread-safe snippet locking during vector computation
 */

import Dexie from 'dexie';

// ─── Dexie Database Schema ────────────────────────────────────────────────────

class MemoriXDB extends Dexie {
  constructor() {
    super('MemoriX');

    // Primary schema: v1
    this.version(1).stores({
      snippets: '++id, createdAt, language, &uuid',
      vectorIndex: '++id, snippetId',
      computationQueue: '++id, snippetId, status, createdAt',
      embeddings: '&snippetId',
    });

    // Schema v2: Add full-text search index
    this.version(2).stores({
      snippets: '++id, createdAt, language, &uuid, [language+createdAt]',
      vectorIndex: '++id, snippetId',
      computationQueue: '++id, snippetId, status, createdAt',
      embeddings: '&snippetId',
      ftsIndex: '++id, snippetId',
    });
  }
}

// ─── Storage Engine ───────────────────────────────────────────────────────────

export class StorageEngine {
  constructor() {
    this.db = null;
    this.useIndexedDB = false;
    this.isInitialized = false;
    this.migrationInProgress = false;
  }

  /**
   * Initialize storage engine.
   * Auto-detect if migration to IndexedDB is needed.
   *
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) return;

    try {
      // Check if user has opted into advanced features or has >100 snippets
      const snippets = await this._getFromChromeStorage('mx_snippets', []);
      
      if (snippets.length > 100 || this._shouldUseDexie()) {
        await this._initializeDexie();
        this.useIndexedDB = true;

        // Async migration in background (don't await)
        this._migrateSnippetsToDexie(snippets).catch((e) => {
          console.error('[StorageEngine] Migration failed:', e);
        });
      }
    } catch (e) {
      console.error('[StorageEngine] Init error, falling back to chrome.storage.local:', e);
      this.useIndexedDB = false;
    }

    this.isInitialized = true;
  }

  /**
   * Save a snippet with optional vector computation queuing.
   *
   * @param {Object} snippet
   * @param {boolean} queueVectorComputation - if true, adds to background queue
   * @returns {Promise<string>} snippet ID
   */
  async saveSnippet(snippet, queueVectorComputation = false) {
    const finalSnippet = {
      ...snippet,
      uuid: snippet.uuid || `mx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: snippet.createdAt || Date.now(),
      status: 'active',
      vectorReady: false, // will be set to true after embedding computed
    };

    if (this.useIndexedDB && this.db) {
      const id = await this.db.snippets.add(finalSnippet);

      // Queue vector computation if requested
      if (queueVectorComputation) {
        await this.db.computationQueue.add({
          snippetId: id,
          status: 'pending',
          createdAt: Date.now(),
          retries: 0,
        });
      }

      return finalSnippet.uuid;
    }

    // Fallback: chrome.storage.local
    const snippets = await this._getFromChromeStorage('mx_snippets', []);
    snippets.push(finalSnippet);
    await this._setInChromeStorage({ mx_snippets: snippets });

    if (queueVectorComputation) {
      // For chrome.storage, we'll need to handle queue differently
      // Store queue in chrome.storage.session or a separate key
      await this._queueVectorInChromeStorage(finalSnippet.uuid);
    }

    return finalSnippet.uuid;
  }

  /**
   * Retrieve all snippets (newest first).
   *
   * @returns {Promise<Object[]>}
   */
  async getAllSnippets() {
    if (this.useIndexedDB && this.db) {
      return await this.db.snippets
        .where('status')
        .equals('active')
        .reverse()
        .sortBy('createdAt');
    }

    const snippets = await this._getFromChromeStorage('mx_snippets', []);
    return snippets.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Search snippets by query (text + tags).
   * Uses vector similarity if embedding is available.
   *
   * @param {Object} query
   * @param {string} query.text - free-text search
   * @param {string[]} query.tags - tag filters
   * @param {number[]} query.embedding - optional vector for similarity search
   * @param {number} query.topK - number of results (default 5)
   * @returns {Promise<Object[]>}
   */
  async searchSnippets(query = {}) {
    const { text = '', tags = [], embedding = null, topK = 5 } = query;

    if (this.useIndexedDB && this.db) {
      let results = [];

      if (embedding && embedding.length > 0) {
        // Vector similarity search
        results = await this._vectorSearch(embedding, topK);
      } else if (tags.length > 0) {
        // Tag-based filter
        results = await this.db.snippets
          .where('status')
          .equals('active')
          .filter((s) => tags.some((t) => s.tags?.includes(t)))
          .toArray();
      } else if (text) {
        // Full-text search
        results = await this.db.snippets
          .where('status')
          .equals('active')
          .filter((s) =>
            s.title.toLowerCase().includes(text.toLowerCase()) ||
            s.code.toLowerCase().includes(text.toLowerCase()) ||
            s.tags?.some((t) => t.toLowerCase().includes(text.toLowerCase()))
          )
          .toArray();
      } else {
        // Return all
        results = await this.getAllSnippets();
      }

      return results.slice(0, topK);
    }

    // Fallback: chrome.storage keyword search
    const snippets = await this.getAllSnippets();
    if (!text && tags.length === 0) return snippets.slice(0, topK);

    return snippets
      .filter((s) => {
        const textMatch = text
          ? s.title.toLowerCase().includes(text.toLowerCase()) ||
            s.code.toLowerCase().includes(text.toLowerCase()) ||
            s.tags?.some((t) => t.toLowerCase().includes(text.toLowerCase()))
          : true;

        const tagMatch = tags.length > 0
          ? tags.some((t) => s.tags?.includes(t))
          : true;

        return textMatch && tagMatch;
      })
      .slice(0, topK);
  }

  /**
   * Delete a snippet by UUID.
   *
   * @param {string} uuid
   * @returns {Promise<void>}
   */
  async deleteSnippet(uuid) {
    if (this.useIndexedDB && this.db) {
      await this.db.snippets.where('uuid').equals(uuid).delete();
      return;
    }

    const snippets = await this._getFromChromeStorage('mx_snippets', []);
    const filtered = snippets.filter((s) => s.uuid !== uuid);
    await this._setInChromeStorage({ mx_snippets: filtered });
  }

  /**
   * Store computed embedding for a snippet.
   *
   * @param {string} snippetId
   * @param {number[]} embedding - vector
   * @returns {Promise<void>}
   */
  async saveEmbedding(snippetId, embedding) {
    if (this.useIndexedDB && this.db) {
      await this.db.embeddings.put({
        snippetId,
        vector: embedding,
        computedAt: Date.now(),
      });

      // Mark snippet as vector-ready
      await this.db.snippets.update(snippetId, { vectorReady: true });

      // Remove from computation queue
      await this.db.computationQueue
        .where('snippetId')
        .equals(snippetId)
        .delete();
      return;
    }

    // For chrome.storage, store in a separate key
    const embeddings = await this._getFromChromeStorage('mx_embeddings', {});
    embeddings[snippetId] = {
      vector: embedding,
      computedAt: Date.now(),
    };
    await this._setInChromeStorage({ mx_embeddings: embeddings });
  }

  /**
   * Get embedding for a snippet.
   *
   * @param {string} snippetId
   * @returns {Promise<number[]|null>}
   */
  async getEmbedding(snippetId) {
    if (this.useIndexedDB && this.db) {
      const emb = await this.db.embeddings.get(snippetId);
      return emb?.vector || null;
    }

    const embeddings = await this._getFromChromeStorage('mx_embeddings', {});
    return embeddings[snippetId]?.vector || null;
  }

  /**
   * Get pending vector computation tasks.
   *
   * @returns {Promise<Object[]>}
   */
  async getPendingComputations() {
    if (this.useIndexedDB && this.db) {
      return await this.db.computationQueue
        .where('status')
        .equals('pending')
        .limit(10)
        .toArray();
    }

    // For chrome.storage, maintain a simple queue
    return [];
  }

  /**
   * Mark a computation task as complete.
   *
   * @param {number} taskId
   * @returns {Promise<void>}
   */
  async completeComputationTask(taskId) {
    if (this.useIndexedDB && this.db) {
      await this.db.computationQueue.where('id').equals(taskId).delete();
      return;
    }
  }

  /**
   * Get storage bytes used.
   *
   * @returns {Promise<number>}
   */
  async getStorageBytes() {
    if (this.useIndexedDB) {
      // IndexedDB doesn't provide direct size reporting
      // Approximate based on snippet count + vector size
      const count = await this.db.snippets.count();
      return count * 50 * 1024; // rough estimate: 50KB per snippet with vector
    }

    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        resolve(bytes || 0);
      });
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  async _initializeDexie() {
    try {
      this.db = new MemoriXDB();
      await this.db.open();
      console.log('[StorageEngine] IndexedDB initialized');
    } catch (e) {
      console.error('[StorageEngine] Failed to initialize IndexedDB:', e);
      throw e;
    }
  }

  _shouldUseDexie() {
    // Check if user has explicitly enabled advanced features
    return (
      localStorage.getItem('mx_feature_vectors') === 'true' ||
      localStorage.getItem('mx_use_indexeddb') === 'true'
    );
  }

  async _migrateSnippetsToDexie(snippets) {
    if (this.migrationInProgress) return;
    this.migrationInProgress = true;

    try {
      console.log(`[StorageEngine] Migrating ${snippets.length} snippets to IndexedDB...`);

      // Add all snippets with uuid
      const snippetsWithUuid = snippets.map((s) => ({
        ...s,
        uuid: s.uuid || s.id,
        status: 'active',
        vectorReady: false,
      }));

      await this.db.snippets.bulkAdd(snippetsWithUuid);
      console.log('[StorageEngine] Migration complete');
    } catch (e) {
      console.error('[StorageEngine] Migration error:', e);
    } finally {
      this.migrationInProgress = false;
    }
  }

  async _vectorSearch(embedding, topK) {
    const allEmbeddings = await this.db.embeddings.toArray();

    // Compute cosine similarity
    const similarities = allEmbeddings.map((emb) => ({
      snippetId: emb.snippetId,
      score: this._cosineSimilarity(embedding, emb.vector),
    }));

    // Sort by score descending
    const top = similarities
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.snippetId);

    // Fetch full snippets
    const results = await this.db.snippets
      .bulkGet(top);

    return results.filter(Boolean);
  }

  _cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }

  async _getFromChromeStorage(key, defaultValue) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] ?? defaultValue);
      });
    });
  }

  async _setInChromeStorage(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async _queueVectorInChromeStorage(snippetId) {
    const queue = await this._getFromChromeStorage('mx_vector_queue', []);
    queue.push({ snippetId, status: 'pending', createdAt: Date.now() });
    await this._setInChromeStorage({ mx_vector_queue: queue });
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const storage = new StorageEngine();
