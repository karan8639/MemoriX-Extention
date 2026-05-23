# MemoriX Phase 2: Implementation Verification Checklist

Use this checklist to verify that all components are working correctly before integrating into the popup UI.

---

## Part 1: Dependency & File Setup

### Package.json
- [ ] Run `npm install` to install Dexie.js
- [ ] Verify `package.json` has `"dexie": "^4.0.0"` in dependencies
- [ ] No build errors after install

### Files Created
- [ ] `/src/core/storage-v2.js` exists (528 lines)
- [ ] `/src/core/vectorIndex.js` updated (203 lines)
- [ ] `/src/core/vectorQueueOrchestrator.js` created (142 lines)
- [ ] `/src/background/vector-worker.js` created (237 lines)
- [ ] `/src/popup/components/RelatePanel.js` updated (380 lines)
- [ ] `/src/popup/RELATE_INTEGRATION.md` created
- [ ] `/manifest.json` updated with vector-worker.js
- [ ] `/PHASE2_IMPLEMENTATION_SUMMARY.md` created

### Manifest Updates
- [ ] `vector-worker.js` added to `web_accessible_resources`
- [ ] No manifest validation errors

---

## Part 2: Backend Infrastructure Tests

### Storage Engine Initialization

**Test**: Does StorageEngine initialize correctly?

```js
// In browser console (background page):
import { storage } from 'chrome-extension://[EXT_ID]/src/core/storage-v2.js';

// Test initialization
await storage.init();
console.log('Storage initialized:', storage.isInitialized);
console.log('Using IndexedDB:', storage.useIndexedDB);
```

**Expected**:
- ✅ `storage.isInitialized === true`
- ✅ `storage.useIndexedDB === true` (if >100 snippets) or `false` (fallback)

---

### IndexedDB Schema

**Test**: Is Dexie database initialized with correct schema?

```js
// In browser console:
const db = storage.db;
const version = db.verno;
const tables = Object.keys(db.tables);
console.log('Dexie version:', version);
console.log('Tables:', tables);

// Should output: ["snippets", "vectorIndex", "computationQueue", "embeddings", "ftsIndex"]
```

**Expected**:
- ✅ `version >= 1`
- ✅ Tables include: `snippets`, `embeddings`, `computationQueue`

---

### Save Snippet with Vector Queueing

**Test**: Does saveSnippet() queue vector computation?

```js
// In browser console:
const testSnippet = await storage.saveSnippet({
  title: "Test Snippet",
  code: "const x = 42;",
  tags: ["test"],
}, true); // true = queueVectorComputation

console.log('Saved snippet UUID:', testSnippet);

// Check if queued
const pending = await storage.getPendingComputations();
console.log('Pending tasks:', pending);
```

**Expected**:
- ✅ Returns a UUID string
- ✅ Pending tasks has 1+ item
- ✅ Task has `status === 'pending'`

---

### Retrieve Snippets

**Test**: Can we retrieve saved snippets?

```js
// In browser console:
const allSnippets = await storage.getAllSnippets();
console.log('Total snippets:', allSnippets.length);
console.log('First snippet:', allSnippets[0]);
```

**Expected**:
- ✅ Array with at least 1 snippet
- ✅ Snippet has fields: uuid, title, code, tags, createdAt

---

## Part 3: Vector Engine Tests

### VectorIndex Initialization

**Test**: Does VectorIndex initialize the SharedWorker?

```js
// In browser console:
import { vectorIndex } from 'chrome-extension://[EXT_ID]/src/core/vectorIndex.js';

console.log('Before init:');
console.log('- modelReady:', vectorIndex.modelReady);
console.log('- worker:', vectorIndex.worker);

// Initialize (this may take 30-60s first time, as it downloads model)
await vectorIndex.init();

console.log('After init:');
console.log('- modelReady:', vectorIndex.modelReady);
console.log('- worker:', !!vectorIndex.worker);
```

**Expected**:
- ✅ `modelReady === true` after init
- ✅ `worker` is a SharedWorker object

---

### Compute Single Embedding

**Test**: Can we compute an embedding for code?

```js
// In browser console (after VectorIndex.init):
const code = "function hello() { console.log('Hello, World!'); }";
const embedding = await vectorIndex.computeEmbedding(code);

console.log('Embedding length:', embedding.length);
console.log('First 5 values:', embedding.slice(0, 5));
console.log('Is normalized:', Math.abs(
  Math.sqrt(embedding.reduce((s, x) => s + x*x, 0)) - 1
) < 0.01);
```

**Expected**:
- ✅ `embedding.length === 384` (dimensions)
- ✅ All values are floats between -1 and 1
- ✅ Vector is normalized (magnitude ≈ 1)

---

### Batch Compute Embeddings

**Test**: Can we compute embeddings for multiple snippets?

```js
// In browser console:
const snippets = [
  { id: 'test_1', code: 'const x = 1;' },
  { id: 'test_2', code: 'const y = 2;' },
  { id: 'test_3', code: 'const z = 3;' },
];

const results = await vectorIndex.batchComputeEmbeddings(snippets);
console.log('Batch results keys:', Object.keys(results));
console.log('test_1 embedding length:', results.test_1.length);
```

**Expected**:
- ✅ Returns object with keys matching input IDs
- ✅ Each value is an array of 384 floats

---

### Find Similar Snippets

**Test**: Can we find similar snippets?

```js
// In browser console:
const queryEmbedding = await vectorIndex.computeEmbedding(
  "function factorial(n) { return n <= 1 ? 1 : n * factorial(n-1); }"
);

const candidates = [
  {
    uuid: 'a',
    code: 'factorial function',
    embedding: await vectorIndex.computeEmbedding(
      "const factorial = (n) => n <= 1 ? 1 : n * factorial(n-1);"
    ),
  },
  {
    uuid: 'b',
    code: 'fibonacci',
    embedding: await vectorIndex.computeEmbedding(
      "function fib(n) { return n <= 1 ? n : fib(n-1) + fib(n-2); }"
    ),
  },
];

const similar = vectorIndex.findSimilar(queryEmbedding, candidates, 2);
console.log('Similar snippets:', similar);
```

**Expected**:
- ✅ Returns array of matches
- ✅ Each match has: uuid, score (0-1)
- ✅ Scores are sorted descending (highest similarity first)
- ✅ Factorial code has higher similarity than fibonacci

---

## Part 4: Background Queue Tests

### Start Orchestrator

**Test**: Does vectorQueueOrchestrator run?

```js
// In browser console:
import { vectorQueueOrchestrator } from 'chrome-extension://[EXT_ID]/src/core/vectorQueueOrchestrator.js';

console.log('Before start:');
console.log('- isRunning:', vectorQueueOrchestrator.isRunning);

vectorQueueOrchestrator.start();

console.log('After start:');
console.log('- isRunning:', vectorQueueOrchestrator.isRunning);

// Wait 10 seconds and check console for logs
setTimeout(() => {
  console.log('Check console for [VectorQueueOrchestrator] logs');
}, 10000);
```

**Expected**:
- ✅ `isRunning` becomes `true`
- ✅ Console shows `[VectorQueueOrchestrator] Started`
- ✅ Periodic polling logs appear

---

### Process Queue

**Test**: Does the queue processor pick up pending tasks?

```js
// In background console (wait for orchestrator to poll):
// Check background service worker console for logs like:
// "[VectorQueueOrchestrator] Found X pending tasks"
// "[VectorQueueOrchestrator] Computing embeddings for Y snippets..."
// "[VectorQueueOrchestrator] Saved embedding for [uuid]"

// Manually check if task was completed:
const pending = await storage.getPendingComputations();
console.log('Remaining pending tasks:', pending.length);
```

**Expected**:
- ✅ Console shows computation progress
- ✅ Pending tasks count decreases
- ✅ Embeddings table gets populated in IndexedDB

---

## Part 5: Integration Tests

### End-to-End: Save → Queue → Compute → Search

```js
// Complete flow test in browser console:

// 1. Save a snippet with vector queueing
const uuid1 = await storage.saveSnippet({
  title: "Algorithm: Merge Sort",
  code: "function mergeSort(arr) { if (arr.length <= 1) return arr; const mid = Math.floor(arr.length / 2); ... }",
  tags: ["algorithm", "sorting"],
}, true);

const uuid2 = await storage.saveSnippet({
  title: "Algorithm: Quick Sort",
  code: "function quickSort(arr) { if (arr.length <= 1) return arr; const pivot = arr[0]; ... }",
  tags: ["algorithm", "sorting"],
}, true);

console.log('Snippets saved:', uuid1, uuid2);

// 2. Wait for queue to process (10-15 seconds)
await new Promise(r => setTimeout(r, 15000));

// 3. Check embeddings were computed
const emb1 = await storage.getEmbedding(uuid1);
const emb2 = await storage.getEmbedding(uuid2);
console.log('Embedding 1 computed:', !!emb1);
console.log('Embedding 2 computed:', !!emb2);

// 4. Search for similar snippets
const results = await storage.searchSnippets({
  embedding: emb1,
  topK: 3,
});
console.log('Similar to merge sort:', results.map(r => r.title));
```

**Expected**:
- ✅ Both snippets save successfully
- ✅ After 15s, embeddings are computed
- ✅ Search returns quick sort as similar
- ✅ No errors in console

---

## Part 6: RelatePanel Component Test

### Component Rendering

```js
// In popup page:
import { RelatePanel, relatePanelStyles } from './components/RelatePanel.js';

// Create container
const container = document.createElement('div');
document.body.appendChild(container);

// Create panel
const panel = new RelatePanel(container);

// Render with mock matches
const mockMatches = [
  {
    uuid: 'test1',
    title: 'React Hook',
    code: 'useState(() => { ... })',
    tags: ['react', 'hooks'],
    score: 0.95,
  },
  {
    uuid: 'test2',
    title: 'Vue Composition',
    code: 'reactive(() => { ... })',
    tags: ['vue'],
    score: 0.72,
  },
];

panel.render(mockMatches);
console.log('Panel visible:', panel.isVisible);
console.log('Matches rendered:', container.innerHTML.length > 100);
```

**Expected**:
- ✅ Panel renders without errors
- ✅ `panel.isVisible === true`
- ✅ Container has HTML (score, titles, buttons visible)
- ✅ No console errors

---

## Part 7: Final Smoke Test

### Browser Extension Full Lifecycle

1. **Open popup**: Alt+Shift+M or click extension icon
2. **Save a snippet**: Paste code, add title, press Ctrl+Enter
3. **Wait 10 seconds**: For background queue to compute embedding
4. **Check background console**: Open `chrome://extensions` → MemoriX → "Inspect background page"
   - Look for: `[VectorQueueOrchestrator]` logs
   - Should see: embedding computation progress
5. **Click "Relate" button** (after integration): Should show similar snippets
6. **Check for errors**: No red errors in any console

---

## ✅ Verification Passing Criteria

**All tests pass if**:
- [ ] Storage initializes with IndexedDB
- [ ] Embeddings are 384-dimensional
- [ ] Vector computation completes in <10s
- [ ] Background queue processes tasks automatically
- [ ] RelatePanel renders without errors
- [ ] No unhandled errors in console
- [ ] Service worker doesn't crash

**If any test fails**:
1. Check console for specific error message
2. Verify import paths are correct
3. Ensure manifest has vector-worker.js in web_accessible_resources
4. Check that Transformers.js loads (network tab in DevTools)

---

## 🎉 Next Steps After Verification

Once all tests pass:

1. Follow [RELATE_INTEGRATION.md](./RELATE_INTEGRATION.md) to wire RelatePanel into popup UI
2. Add "🧲 Relate" button to snippet cards
3. Implement `handleRelateClick()` in popup.js
4. Test end-to-end: save → wait → click relate → see matches

---

## Debugging Tips

### Common Issues

**Issue**: "Transformers is not defined"
- **Cause**: SharedWorker failed to load from CDN
- **Solution**: Check network tab, ensure CDN is accessible

**Issue**: "IndexedDB quota exceeded"
- **Cause**: Too many embeddings stored
- **Solution**: Enable quota storage: `navigator.storage.persist()`

**Issue**: "Vector computation timeout"
- **Cause**: Model still downloading
- **Solution**: Wait longer (first run can take 60s)

**Issue**: "computationQueue is empty"
- **Cause**: Orchestrator hasn't started
- **Solution**: Call `vectorQueueOrchestrator.start()`

---

## Questions?

Refer to:
- [PHASE2_IMPLEMENTATION_SUMMARY.md](./PHASE2_IMPLEMENTATION_SUMMARY.md) — Overall architecture
- [RELATE_INTEGRATION.md](./RELATE_INTEGRATION.md) — Popup integration steps
- Individual component files — Detailed JSDoc comments
