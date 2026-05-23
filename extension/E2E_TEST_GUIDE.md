# MemoriX Phase 2: End-to-End Testing Guide

**Date**: May 24, 2026  
**Objective**: Verify complete flow from snippet save → vector computation → relate search

---

## Part 1: Load Extension in Chrome (Dev Mode)

### Step 1.1: Open Chrome Extensions Page
1. Open Chrome
2. Go to `chrome://extensions`
3. Enable **"Developer mode"** (toggle in top-right)

### Step 1.2: Load Unpacked Extension
1. Click **"Load unpacked"**
2. Navigate to: `d:\ongoing projects\claud projects\memorix\extension`
3. Select the **`extension`** folder
4. ✅ Extension should appear in the list with ID like `ebhgmfhajcafedlca`

### Step 1.3: Verify Installation
```
Expected:
✓ MemoriX extension visible in chrome://extensions
✓ Red/green icon appears in toolbar
✓ "Errors" section is empty
✓ Version shows "0.1.0"
```

---

## Part 2: Open DevTools Consoles

You'll need 2 DevTools windows open simultaneously:

### Console 1: Popup Console
1. Right-click MemoriX icon in toolbar
2. Select **"Inspect popup"**
3. Go to **Console** tab
4. ⚠️ **Keep this open** throughout testing

### Console 2: Background Service Worker Console
1. Go to `chrome://extensions`
2. Find **MemoriX**
3. Click **"Inspect views: background page"**
4. Go to **Console** tab
5. ⚠️ **Keep this open** throughout testing

---

## Part 3: Test Suite

### Test 1: Extension Loads Without Errors

**What to check**:
- [ ] No red errors in popup console
- [ ] No red errors in background console
- [ ] Both consoles loaded successfully

**Popup console should show** (from service-worker.js):
```
[MemoriX][SW] Service worker script evaluated — v0.1.0
[MemoriX][SW] onStartup · browser launched · v0.1.0
[MemoriX][SW] Storage engine and vector orchestrator initialized
```

**If error**: Check manifest.json and imports. The vector-worker.js import path must be correct.

---

### Test 2: Open Popup UI

**Action**: Click MemoriX icon in toolbar to open popup

**Expected UI**:
- [ ] Dark theme loads (black background, green accents)
- [ ] "Add Snippet" panel at top
- [ ] Empty snippet list ("No snippets yet")
- [ ] All buttons responsive
- [ ] No layout breaks

**Popup console should NOT show errors**

---

### Test 3: Save a Snippet (Queue Vector Computation)

**Action**: In popup, add a test snippet:
1. Type **Title**: `"React Hook: useState"`
2. Paste **Code**:
   ```js
   function Counter() {
     const [count, setCount] = useState(0);
     return (
       <div>
         <p>Count: {count}</p>
         <button onClick={() => setCount(count + 1)}>+</button>
       </div>
     );
   }
   ```
3. Press **Ctrl+Enter** (or click Save button)

**Expected Popup Behavior**:
- [ ] Snippet appears at top of list immediately
- [ ] Green toast: "✓ Saved to local storage"
- [ ] Title shows: "React Hook: useState"
- [ ] Code preview shows first few lines
- [ ] Tags auto-detected: `["react", "js"]` or similar
- [ ] Timestamp shows: "now" or "0s ago"

**Expected Background Console**:
```
[MemoriX][SW] SNIPPET_SAVE received — saving to storage engine
[MemoriX][SW] Snippet saved with ID: mx_[timestamp]_[random]
```

**Check IndexedDB** (verify storage worked):
```js
// In popup console:
import { storage } from '/src/core/storage-v2.js';
await storage.init();
const all = await storage.getAllSnippets();
console.log('Snippets:', all);
// Should show 1 snippet with your code
```

---

### Test 4: Monitor Background Queue Processing

⏱️ **Wait 15-20 seconds after saving** for vector computation

**Expected Background Console Logs**:

After ~5 seconds:
```
[VectorQueueOrchestrator] Found 1 pending tasks
[VectorQueueOrchestrator] Computing embeddings for 1 snippets...
```

After 5-10 more seconds (model loading + computation):
```
[VectorWorker] SharedWorker script loaded, awaiting connections...
[VectorWorker] New client connected. Total ports: 1
[VectorWorker] Loading Transformers.js...
[VectorWorker] Loading model: Xenova/distiluse-base-multilingual-cased-v2...
[VectorWorker] Model loaded and ready
[VectorQueueOrchestrator] Saved embedding for mx_[uuid]
```

**If no logs appear**:
- ❌ Background service worker may have crashed
- ✅ Solution: Reload extension in `chrome://extensions`

**What's happening**:
1. Orchestrator polls every 5s
2. Finds your snippet in pending queue
3. Sends to SharedWorker (non-blocking)
4. Transformers.js loads model (~50MB, cached after)
5. Embedding computed (384-dim vector)
6. Saved to IndexedDB
7. Task marked complete

---

### Test 5: Verify Embeddings in IndexedDB

**In popup console**, after vector computation completes:

```js
// Check if embedding was saved
import { storage } from '/src/core/storage-v2.js';
const snippets = await storage.getAllSnippets();
const uuid = snippets[0].uuid;

const embedding = await storage.getEmbedding(uuid);
console.log('Embedding computed:', !!embedding);
console.log('Vector length:', embedding?.length);
console.log('First 5 values:', embedding?.slice(0, 5));

// Should output:
// Embedding computed: true
// Vector length: 384
// First 5 values: [0.123, -0.456, 0.789, ...]
```

✅ **Test passes if**: Embedding is 384 dimensions, all floats between -1 and 1

---

### Test 6: Save a Second Snippet (Different Topic)

**Action**: Add another snippet with different code

1. Type **Title**: `"Vue Composition API"`
2. Paste **Code**:
   ```js
   import { ref, computed } from 'vue';
   
   export default {
     setup() {
       const count = ref(0);
       const doubled = computed(() => count.value * 2);
       return { count, doubled };
     }
   };
   ```
3. Press **Ctrl+Enter**

**Expected**:
- [ ] Second snippet appears above first
- [ ] Auto-tagged as `["vue", "js"]` or similar
- [ ] Vector computation queued automatically
- [ ] Background console shows new computation

**Wait 10-15 seconds for vector computation**

---

### Test 7: Click "Relate" Button (The Magic! 🧲)

**Prerequisite**: Both snippets must have embeddings computed (check background console)

**Action**: 
1. On the first snippet (React Hook), look for **"🧲 Relate"** button
2. Click it

**Expected Popup Console Logs**:
```
[Popup] Initializing vector model...
[Popup] Computing embedding...
[Popup] Vector model ready
```

**Expected UI**:
- [ ] Modal/panel appears below snippet: "🧲 Related Snippets"
- [ ] Shows Vue Composition snippet with match score
- [ ] Score displays as percentage (e.g., "72% similar")
- [ ] Snippet title, tags, and code preview visible
- [ ] "📋 Copy" and "✨ Use" buttons present

**If model takes time to load**:
- ⏳ Wait 30-60 seconds on first click (model downloads ~50MB)
- ✅ Subsequent "Relate" clicks will be instant (<200ms)

**Check the match score logic**:
```js
// In popup console, verify similarity calculation:
import { vectorIndex } from '/src/core/vectorIndex.js';

const emb1 = [/* first 384 floats */];
const emb2 = [/* second 384 floats */];

const similarity = vectorIndex._cosineSimilarity(emb1, emb2);
console.log('Cosine similarity:', similarity);
// Should be between 0 (opposite) and 1 (identical)
// React ↔ Vue should be ~0.6-0.8 (both frameworks, similar patterns)
```

---

### Test 8: Test Copy Button

**Action**: In the RelatePanel, click **"📋 Copy"** on the related snippet

**Expected**:
- [ ] Button text changes to "✓ Copied"
- [ ] Green toast appears: "Copied to clipboard! 📋"
- [ ] After 2s, button reverts to "📋 Copy"

**Verify clipboard**:
```js
// In popup console:
const text = await navigator.clipboard.readText();
console.log('Clipboard contains Vue code:', text.includes('ref'));
```

---

### Test 9: Test Close Button

**Action**: In RelatePanel, click **"×"** button (top-right)

**Expected**:
- [ ] RelatePanel disappears
- [ ] Popup returns to normal snippet list view

---

### Test 10: Refresh Page & Verify Persistence

**Action**: 
1. Click popup icon again (closes popup)
2. Click again (reopens popup)

**Expected**:
- [ ] Both snippets still visible
- [ ] Tags preserved
- [ ] Timestamps unchanged (if refresh was quick)

**Verify IndexedDB persisted**:
```js
// In popup console after refresh:
import { storage } from '/src/core/storage-v2.js';
await storage.init();
const snippets = await storage.getAllSnippets();
console.log('Snippets persisted:', snippets.length); // Should be 2
```

---

## Part 4: Error Cases & Recovery

### Error Case 1: Background Service Worker Crash

**Symptom**: No logs in background console after saving

**Recovery**:
1. Go to `chrome://extensions`
2. Find MemoriX
3. Click "Service Worker" link under "Inspect views"
4. Check console for errors
5. If crashed, reload extension: Click refresh icon next to MemoriX

---

### Error Case 2: Model Won't Download

**Symptom**: "Failed to load Transformers.js" error after clicking Relate

**Recovery**:
- Check network tab in DevTools (F12 → Network)
- Look for requests to `cdn.jsdelivr.net`
- If blocked, extension can't access CDN
- Solution: Check firewall/proxy settings

---

### Error Case 3: IndexedDB Quota Exceeded

**Symptom**: "QuotaExceededError" in console

**Recovery**:
```js
// In popup console:
await navigator.storage.persist();
console.log('Storage persisted:', await navigator.storage.persisted());
```

---

## Part 5: Performance Benchmarks

### What to Measure

| Operation | Expected Time | How to Measure |
|-----------|---------------|----------------|
| Save snippet | <50ms | Check console.time() |
| Vector compute | 2-5s per snippet | Check background logs |
| Relate search | <200ms | Check popup console |
| Model download | 30-60s (first time) | Check network tab |

**Measure save time**:
```js
// In popup console:
console.time('save');
await storage.saveSnippet({...}, true);
console.timeEnd('save');
// Output: save: 45.3ms
```

---

## Part 6: Full End-to-End Checklist

### ✅ Extension Loads
- [ ] No errors in DevTools
- [ ] Service worker initialized
- [ ] Icon visible in toolbar

### ✅ UI Works
- [ ] Popup opens
- [ ] Dark theme loads correctly
- [ ] Add panel responds to input

### ✅ Save & Queue
- [ ] Snippet saves instantly (<50ms)
- [ ] Toast confirmation appears
- [ ] Vector computation queued
- [ ] Background logs show queueing

### ✅ Vector Computation
- [ ] Orchestrator polls every ~5s
- [ ] Model loads on first computation
- [ ] Embeddings computed in background
- [ ] Results saved to IndexedDB (384-dim)

### ✅ Search & Match
- [ ] Relate button visible
- [ ] Clicking starts embedding computation
- [ ] RelatePanel renders top matches
- [ ] Similarity scores displayed (0-100%)

### ✅ Persistence
- [ ] Snippets persist after refresh
- [ ] Embeddings stay in IndexedDB
- [ ] No data loss

### ✅ UI Actions
- [ ] Copy button works
- [ ] Close button works
- [ ] No console errors during actions

---

## Part 7: Success Criteria

**End-to-end test PASSES if**:

✅ Can save snippet and see it in list  
✅ Background console shows orchestrator polling  
✅ Vector computation completes in 10-20 seconds  
✅ Clicking "Relate" shows similar snippets  
✅ Similarity scores are meaningful (0.6-0.95 for related code)  
✅ Copy button works  
✅ Data persists after refresh  
✅ No unhandled errors in either console  

---

## Next Steps After E2E Test

1. **If all pass**: ✅ Core Phase 2 is production-ready
2. **If failures**: Debug using the error recovery guide above
3. **Integration**: Follow [RELATE_INTEGRATION.md](../src/popup/RELATE_INTEGRATION.md) to wire into popup UI
4. **Polish**: Performance optimization, edge case handling

---

## Debugging Commands Quick Reference

```js
// Check storage
import { storage } from '/src/core/storage-v2.js';
await storage.init();
const snippets = await storage.getAllSnippets();
console.log('Snippets:', snippets.length);

// Check embeddings
const uuid = snippets[0].uuid;
const emb = await storage.getEmbedding(uuid);
console.log('Has embedding:', !!emb, 'length:', emb?.length);

// Check queue
const pending = await storage.getPendingComputations();
console.log('Pending tasks:', pending.length);

// Start orchestrator (if not running)
import { vectorQueueOrchestrator } from '/src/core/vectorQueueOrchestrator.js';
vectorQueueOrchestrator.start();
console.log('Orchestrator running:', vectorQueueOrchestrator.isRunning);

// Test vector computation
import { vectorIndex } from '/src/core/vectorIndex.js';
await vectorIndex.init();
const emb = await vectorIndex.computeEmbedding('const x = 1;');
console.log('Embedding length:', emb.length);
```

---

## Expected Output Examples

### Successful Save
```
Console [Popup]:
✓ Saved to local storage (green toast)

Console [Background]:
[MemoriX][SW] SNIPPET_SAVE received
[MemoriX][SW] Snippet saved with ID: mx_1716543210000_a1b2c
```

### Successful Vector Computation
```
Console [Background] (after ~10 seconds):
[VectorQueueOrchestrator] Found 1 pending tasks
[VectorQueueOrchestrator] Computing embeddings for 1 snippets...
[VectorWorker] Model loaded and ready
[VectorQueueOrchestrator] Saved embedding for mx_1716543210000_a1b2c
```

### Successful Relate
```
Console [Popup]:
[Popup] Computing embedding...

UI:
🧲 Related Snippets
├─ 85% similar: Vue Composition API
│  └─ [📋 Copy] [✨ Use]
└─ 62% similar: Python FastAPI
   └─ [📋 Copy] [✨ Use]
```

---

**Ready to test? Follow the steps above!** 🚀
