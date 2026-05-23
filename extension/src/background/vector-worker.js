/**
 * MemoriX — Vector Worker (SharedWorker)
 *
 * Runs in isolated worker context. Lazy-loads Transformers.js
 * and compute embeddings without blocking the main extension threads.
 *
 * Model: Xenova/distiluse-base-multilingual-cased-v2
 *  - ~50MB (cached locally)
 *  - 384-dimensional embeddings
 *  - Optimized for semantic similarity
 *  - Supports 50+ languages
 *
 * Ports connected from:
 *  - popup/index.html
 *  - background/service-worker.js
 *  - sidepanel/index.html
 */

let ports = [];
let extractor = null;
let modelReady = false;

const MODEL_NAME = 'Xenova/distiluse-base-multilingual-cased-v2';

// ─── Worker Lifecycle ─────────────────────────────────────────────────────────

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.push(port);

  port.onmessage = (e) => handleMessage(e, port);
  port.start();

  console.log(`[VectorWorker] New client connected. Total ports: ${ports.length}`);
};

// ─── Message Handler ─────────────────────────────────────────────────────────

async function handleMessage(event, port) {
  const { taskId, type, payload } = event.data;

  try {
    let result;

    switch (type) {
      case 'INIT':
        await initModel();
        result = { ready: true };
        break;

      case 'EMBED':
        result = await embedText(payload.code);
        break;

      case 'BATCH_EMBED':
        result = await batchEmbedText(payload.snippets);
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    port.postMessage({ taskId, payload: result });
  } catch (error) {
    console.error(`[VectorWorker] Error processing ${type}:`, error);
    port.postMessage({
      taskId,
      error: error.message,
    });
  }
}

// ─── Model Initialization ─────────────────────────────────────────────────────

async function initModel() {
  if (modelReady) return;

  console.log(`[VectorWorker] Loading Transformers.js...`);

  try {
    // Dynamically import Transformers.js (lazy load)
    const { pipeline } = await import(
      'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.0'
    );

    console.log(`[VectorWorker] Loading model: ${MODEL_NAME}...`);

    extractor = await pipeline('feature-extraction', MODEL_NAME, {
      // Use ONNX model for better performance
      quantized: true,
    });

    modelReady = true;
    console.log(`[VectorWorker] Model loaded and ready`);
  } catch (error) {
    console.error('[VectorWorker] Model loading failed:', error);
    throw new Error(`Failed to load Transformers.js model: ${error.message}`);
  }
}

// ─── Embedding Functions ──────────────────────────────────────────────────────

async function embedText(text) {
  if (!modelReady) {
    throw new Error('Model not initialized');
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Invalid text for embedding');
  }

  try {
    // Extract features returns a tensor, convert to Array
    const embedding = await extractor(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert tensor to array and extract values
    return Array.from(embedding.data);
  } catch (error) {
    console.error('[VectorWorker] Embedding failed:', error);
    throw new Error(`Embedding computation failed: ${error.message}`);
  }
}

async function batchEmbedText(snippets) {
  if (!modelReady) {
    throw new Error('Model not initialized');
  }

  if (!Array.isArray(snippets)) {
    throw new Error('Snippets must be an array');
  }

  const results = {};

  try {
    for (let i = 0; i < snippets.length; i++) {
      const { id, code } = snippets[i];

      try {
        results[id] = await embedText(code);

        // Send progress update
        broadcastProgress({
          type: 'BATCH_PROGRESS',
          current: i + 1,
          total: snippets.length,
        });
      } catch (e) {
        console.warn(
          `[VectorWorker] Failed to embed snippet ${id}:`,
          e.message
        );
        results[id] = null; // Mark as failed
      }
    }

    return results;
  } catch (error) {
    console.error('[VectorWorker] Batch embedding failed:', error);
    throw new Error(`Batch embedding failed: ${error.message}`);
  }
}

// ─── Broadcasting (multicast to all connected ports) ──────────────────────────

function broadcastProgress(message) {
  ports.forEach((port) => {
    try {
      port.postMessage(message);
    } catch (e) {
      console.warn('[VectorWorker] Failed to send to port:', e);
    }
  });
}

// ─── Startup Logging ──────────────────────────────────────────────────────────

console.log('[VectorWorker] SharedWorker script loaded, awaiting connections...');
