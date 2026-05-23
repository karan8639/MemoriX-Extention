/**
 * MemoriX — Smart Scratchpad · popup.js
 *
 * Complete implementation of a browser-based code snippet manager.
 * 
 * Architecture:
 *  State    → pure JS object, mutated via setState()
 *  Storage  → chrome.storage.local, all I/O isolated in StorageService
 *  Categorizer → deterministic, zero-network keyword + pattern engine
 *  Render   → full re-render on state change (performant at <500 snippets)
 *
 * No external dependencies. No network calls. 100% local & offline-first.
 */

"use strict";

// ─── Browser/Testing Mock ───────────────────────────────────────────────────
if (typeof chrome === "undefined" || !chrome.storage) {
  console.warn("[MemoriX] Chrome APIs not found. Injecting mocks for testing...");
  window.chrome = {
    storage: {
      local: {
        _data: JSON.parse(localStorage.getItem("mx_mock_storage") || "{}"),
        get(key, cb) {
          const res = {};
          if (Array.isArray(key)) {
            key.forEach(k => res[k] = this._data[k]);
          } else {
            res[key] = this._data[key];
          }
          setTimeout(() => cb(res), 10);
        },
        set(data, cb) {
          Object.assign(this._data, data);
          localStorage.setItem("mx_mock_storage", JSON.stringify(this._data));
          if (cb) setTimeout(cb, 10);
        },
        remove(key, cb) {
          delete this._data[key];
          localStorage.setItem("mx_mock_storage", JSON.stringify(this._data));
          if (cb) setTimeout(cb, 10);
        },
        clear(cb) {
          this._data = {};
          localStorage.removeItem("mx_mock_storage");
          if (cb) setTimeout(cb, 10);
        },
        getBytesInUse(key, cb) {
          setTimeout(() => cb(JSON.stringify(this._data).length), 10);
        }
      }
    },
    runtime: {
      lastError: null,
      getURL: (path) => path,
      onMessage: { 
        addListener: () => {},
        removeListener: () => {}
      },
      sendMessage: (msg, cb) => {
        console.log("[Mock] sendMessage:", msg);
        if (cb) setTimeout(() => cb({ ok: true, status: "ok" }), 10);
      }
    },
    action: {
      setBadgeBackgroundColor: () => {},
      setBadgeTextColor: () => {}
    },
    tabs: {
      query: (opts, cb) => cb([{ id: 1, url: "http://localhost" }]),
      sendMessage: (id, msg, cb) => cb({ status: "ok" })
    }
  };
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  SNIPPETS: "mx_snippets",
  SETTINGS: "mx_settings",
};

const MAX_SNIPPETS = 500; // soft cap to protect chrome.storage quota

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  snippets:      [],   // SnippetRecord[]
  activeTag:     "all",
  searchQuery:   "",
  addPanelOpen:  false,
  storageBytes:  0,
};

function setState(patch) {
  Object.assign(state, patch);
  render();
}

// ─── StorageService ───────────────────────────────────────────────────────────

const StorageService = {
  async loadSnippets() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEYS.SNIPPETS, (result) => {
        const snippets = result[STORAGE_KEYS.SNIPPETS] || [];
        // Sort newest first
        resolve(snippets.sort((a, b) => b.createdAt - a.createdAt));
      });
    });
  },

  async saveSnippets(snippets) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(
        { [STORAGE_KEYS.SNIPPETS]: snippets },
        () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        }
      );
    });
  },

  async getStorageBytes() {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        resolve(bytes || 0);
      });
    });
  },
};

// ─── Auto-Categorizer ─────────────────────────────────────────────────────────

/**
 * Deterministic multi-signal language + category detector.
 * Priority order: shebang → import/syntax patterns → keywords → fallback.
 *
 * Returns a sorted, deduplicated array of tag strings.
 * @param {string} code
 * @returns {string[]}
 */
const Categorizer = {

  LANGUAGE_RULES: [
    // — Shebangs —
    ["bash",       (c) => /^#!\s*\/(?:usr\/)?(?:local\/)?bin\/(?:env\s+)?(?:bash|sh|zsh)/m.test(c)],

    // — TypeScript (before JS — more specific) —
    ["ts",         (c) => /(?::\s*(?:string|number|boolean|void|any|never|unknown|Record|Partial)\b|interface\s+\w|type\s+\w+\s*=|as\s+\w+>|<\w+>\s*\(|implements\s+\w|enum\s+\w|readonly\s+\w)/.test(c)],

    // — JavaScript —
    ["js",         (c) => /(?:(?:const|let|var)\s+\w|=>|require\(|module\.exports|import\s+.*from\s+['"]|async\s+function|await\s+\w|Promise\.|\.then\(|\.catch\()/.test(c)],

    // — Python —
    ["py",         (c) => /(?:def\s+\w+\s*\(|import\s+\w|from\s+\w+\s+import|print\(|if\s+__name__|class\s+\w+.*:|\bself\b|lambda\s+\w|elif\b|:\s*$)/m.test(c)],

    // — Rust —
    ["rust",       (c) => /(?:fn\s+\w+|let\s+mut\s+|impl\s+\w|use\s+std::|->.*Result|#\[derive|println!\(|match\s+\w|Some\(|None\b|unwrap\(\))/.test(c)],

    // — Go —
    ["go",         (c) => /(?:func\s+\w+|package\s+\w+|import\s+\(|:=|fmt\.|go\s+func|chan\s+\w|defer\s+\w)/.test(c)],

    // — Java —
    ["java",       (c) => /(?:public\s+(?:static\s+)?(?:void|class|interface)|System\.out\.|@Override|new\s+\w+\(|extends\s+\w|implements\s+\w|throws\s+\w)/.test(c)],

    // — C# —
    ["cs",         (c) => /(?:using\s+System|namespace\s+\w|public\s+(?:static\s+)?(?:class|void|int|string|bool)|Console\.Write|async\s+Task)/.test(c)],

    // — C / C++ —
    ["cpp",        (c) => /(?:#include\s*<|std::|cout\s*<<|cin\s*>>|::\w+|template\s*<|nullptr\b|->|new\s+\w+\[|delete\s+\w)/.test(c)],

    // — Ruby —
    ["ruby",       (c) => /(?:def\s+\w+|end\b|puts\s+|require\s+['"]|attr_(?:reader|writer|accessor)|class\s+\w+\s*<|\bdo\s*\||\byield\b|\.each\s*\{|\bnil\b)/.test(c)],

    // — PHP —
    ["php",        (c) => /(?:<\?php|\$\w+\s*=|echo\s+|function\s+\w+|->|\$this->|array\(|namespace\s+\w|use\s+\w+\\)/.test(c)],

    // — Swift —
    ["swift",      (c) => /(?:import\s+(?:UIKit|Foundation|SwiftUI)|var\s+\w+\s*:\s*\w|let\s+\w+\s*:\s*\w|func\s+\w+.*->|\bguard\b|\boptional\b|@State)/.test(c)],

    // — Kotlin —
    ["kotlin",     (c) => /(?:fun\s+\w+|val\s+\w+|var\s+\w+\s*:\s*\w|data\s+class|companion\s+object|\.let\s*\{|it\.\w|when\s*\()/.test(c)],

    // — SQL —
    ["sql",        (c) => /(?:SELECT\s+.+FROM|INSERT\s+INTO|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|WHERE\s+\w|JOIN\s+\w|GROUP\s+BY|ORDER\s+BY)/i.test(c)],

    // — GraphQL —
    ["graphql",    (c) => /(?:query\s+\w+\s*\{|mutation\s+\w+\s*\{|type\s+\w+\s*\{|schema\s*\{|fragment\s+\w+\s+on\s+\w|\$\w+:\s*\w+!?)/.test(c)],

    // — HTML —
    ["html",       (c) => /(?:<(?:html|head|body|div|span|p|a|img|script|style|link|meta|form|input|button|table|ul|ol|li|h[1-6])\b)/.test(c)],

    // — CSS / SCSS —
    ["css",        (c) => /(?:[\w-]+\s*:\s*[\w#%().,\s]+;|@media\s*\(|@keyframes\s+\w|@import\s+['"]|--[\w-]+\s*:|&\s*[.:#]|\$\w+\s*:)/.test(c)],

    // — JSON —
    ["json",       (c) => /^\s*[\[{]/.test(c.trim()) && /(?:"[\w-]+":\s*(?:"[^"]*"|\d+|true|false|null|\[|\{))/.test(c)],

    // — YAML —
    ["yaml",       (c) => /(?:^\w[\w-]*:\s*\S|^\s+-\s+\w|---\s*$|^\s+\w[\w-]*:\s*)/m.test(c)],

    // — Docker —
    ["docker",     (c) => /(?:^FROM\s+\w|^RUN\s+|^CMD\s+\[|^EXPOSE\s+\d|^ENV\s+\w|^COPY\s+\w|^ENTRYPOINT\s+)/m.test(c)],

    // — Bash / Shell —
    ["bash",       (c) => /(?:echo\s+["']|if\s+\[\s+|fi\s*$|for\s+\w+\s+in\s+|done\s*$|chmod\s+|grep\s+|sed\s+|awk\s+|\$\{?\w+\}?)/.test(c)],
  ],

  FRAMEWORK_RULES: [
    ["react",      (c) => /(?:import\s+React|from\s+['"]react['"]|jsx|useState|useEffect|useRef|useMemo|useCallback|<\w+\s*\/>|className=)/.test(c)],
    ["vue",        (c) => /(?:<template>|<script setup|defineComponent|ref\(|reactive\(|computed\(|v-(?:if|for|bind|model|on)|@click=)/.test(c)],
    ["next",       (c) => /(?:from\s+['"]next\/|getStaticProps|getServerSideProps|useRouter|next\.config)/.test(c)],
  ],

  UTILITY_RULES: [
    ["regex",      (c) => /(?:\/(?:[^/\n\\]|\\.)+\/[gimsuy]*|new\s+RegExp\()/.test(c)],
    ["algorithm",  (c) => /(?:O\((?:n|log|1)\)|binary.?search|BFS|DFS|recursion|memoize|dynamic.?program|sort\w*\(|merge.?sort|quick.?sort)/i.test(c)],
    ["config",     (c) => /(?:module\.exports\s*=|export\s+default\s*\{|"scripts"\s*:|"dependencies"\s*:|"devDependencies"\s*:)/.test(c)],
  ],

  categorize(code) {
    if (!code?.trim()) return [];

    const tags = new Set();

    for (const [tag, test] of this.LANGUAGE_RULES) {
      if (test(code)) tags.add(tag);
    }

    for (const [tag, test] of this.FRAMEWORK_RULES) {
      if (test(code)) tags.add(tag);
    }

    for (const [tag, test] of this.UTILITY_RULES) {
      if (test(code)) tags.add(tag);
    }

    if (tags.size === 0) tags.add("snippet");

    // Promote framework-implied language if not already set
    if (tags.has("react") && !tags.has("ts") && !tags.has("js")) tags.add("js");
    if (tags.has("vue")   && !tags.has("ts") && !tags.has("js")) tags.add("js");

    return [...tags].sort();
  },
};

// ─── Snippet Record Factory ───────────────────────────────────────────────────

function createSnippet({ title, code, tags, sourceUrl, sourceTitle }) {
  return {
    id:          `mx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title:       title?.trim() ?? "",
    code:        code.trim(),
    tags,
    sourceUrl:   sourceUrl ?? null,
    sourceTitle: sourceTitle ?? null,
    createdAt:   Date.now(),
  };
}

// ─── Tag Colour Map ───────────────────────────────────────────────────────────

function tagClass(tag) {
  const map = {
    js: "tag-js", ts: "tag-ts", py: "tag-py", rust: "tag-rust",
    go: "tag-go", css: "tag-css", html: "tag-html", java: "tag-java",
    cs: "tag-cs", cpp: "tag-cpp", ruby: "tag-ruby", php: "tag-php",
    swift: "tag-swift", kotlin: "tag-kotlin", sql: "tag-sql",
    bash: "tag-bash", json: "tag-json", yaml: "tag-yaml",
    graphql: "tag-graphql", docker: "tag-docker", regex: "tag-regex",
    react: "tag-react", vue: "tag-vue", next: "tag-next",
    algorithm: "tag-algorithm", config: "tag-config", snippet: "tag-snippet",
  };
  return map[tag] ?? "tag-snippet";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer = null;

function showToast(msg, type = "info", duration = 2000) {
  const el = document.getElementById("toast");
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.className = `show ${type}`;
  toastTimer = setTimeout(() => { el.className = ""; }, duration);
}

// ─── Derived Data ─────────────────────────────────────────────────────────────

function filteredSnippets() {
  let list = [...state.snippets];

  if (state.activeTag !== "all") {
    list = list.filter((s) => s.tags.includes(state.activeTag));
  }

  const q = state.searchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter((s) =>
      s.title.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      s.tags.some((t) => t.includes(q))
    );
  }

  return list;
}

function allTags() {
  const freq = {};
  for (const s of state.snippets) {
    for (const t of s.tags) {
      freq[t] = (freq[t] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
}

// ─── Render Engine ────────────────────────────────────────────────────────────

function render() {
  renderSnippetCount();
  renderTagFilterRow();
  renderSnippetList();
  renderStorageBar();
  renderAddPanel();
}

function renderAddPanel() {
  const el = document.getElementById("add-panel");
  if (state.addPanelOpen) {
    el.classList.remove("collapsed");
  } else {
    el.classList.add("collapsed");
  }
}

function renderSnippetCount() {
  const el = document.getElementById("snippet-count");
  const n  = state.snippets.length;
  el.textContent = `${n} snippet${n !== 1 ? "s" : ""}`;
}

function renderTagFilterRow() {
  const row  = document.getElementById("tag-filter-row");
  const tags = allTags();

  if (tags.length === 0) { row.innerHTML = ""; return; }

  const allBtn = `
    <button
      class="filter-tag all ${state.activeTag === "all" ? "active" : "inactive"}"
      data-tag="all"
    >ALL</button>
  `;

  const tagBtns = tags.map(({ tag, count }) => `
    <button
      class="filter-tag ${tagClass(tag)} ${state.activeTag === tag ? "" : "inactive"}"
      data-tag="${tag}"
      title="${count} snippet${count !== 1 ? "s" : ""}"
    >${tag.toUpperCase()}</button>
  `).join("");

  row.innerHTML = allBtn + tagBtns;
}

function renderSnippetList() {
  const wrap   = document.getElementById("snippet-list-wrap");
  const empty  = document.getElementById("empty-state");
  const list   = filteredSnippets();

  // Remove all cards (keep empty-state in DOM)
  wrap.querySelectorAll(".snippet-card").forEach((el) => el.remove());

  if (list.length === 0) {
    empty.style.display = "flex";

    const hasSnippets = state.snippets.length > 0;
    const isFiltering = state.activeTag !== "all" || state.searchQuery.trim();
    empty.innerHTML = hasSnippets && isFiltering
      ? `<span class="empty-glyph">⌕</span><p>No snippets match<br />"${escapeHtml(state.searchQuery || state.activeTag)}"</p>`
      : `<span class="empty-glyph">⬡</span><p>No snippets yet.<br />Hit <kbd>+ NEW</kbd> to save your first one.</p>`;
    return;
  }

  empty.style.display = "none";

  // Render newest-first (already sorted by filteredSnippets)
  for (const snippet of list) {
    const card = buildCard(snippet);
    wrap.appendChild(card);
  }
}

function buildCard(snippet) {
  const card = document.createElement("article");
  card.className = "snippet-card";
  card.dataset.id = snippet.id;
  card.setAttribute("role", "listitem");

  const tagsHtml = snippet.tags.map((t) =>
    `<span class="tag ${tagClass(t)}">${t}</span>`
  ).join("");

  const isLong = snippet.code.split("\n").length > 6 || snippet.code.length > 300;

  card.innerHTML = `
    <div class="card-header">
      <div class="card-header-left">
        <span class="card-title ${!snippet.title ? "untitled" : ""}">${
          snippet.title ? escapeHtml(snippet.title) : "Untitled snippet"
        }</span>
      </div>
      <div class="card-tags">${tagsHtml}</div>
      <div class="card-actions">
        <button class="card-btn" data-action="copy" title="Copy to clipboard">⎘</button>
        <button class="card-btn danger" data-action="delete" title="Delete snippet">✕</button>
      </div>
    </div>
    <div class="card-code-wrap" id="wrap-${snippet.id}">
      <code class="card-code">${escapeHtml(snippet.code)}</code>
      ${isLong ? '<div class="code-fade"></div>' : ""}
    </div>
    ${isLong ? `<button class="btn-expand" data-action="expand" data-id="${snippet.id}">▾ show more</button>` : ""}
    <div class="card-footer">
      <span class="card-meta">${formatRelativeTime(snippet.createdAt)}</span>
    </div>
  `;

  return card;
}

function renderStorageBar() {
  const bytes = state.storageBytes;
  const QUOTA = 10 * 1024 * 1024; // 10 MB
  const pct   = Math.min((bytes / QUOTA) * 100, 100).toFixed(1);

  document.getElementById("storage-fill").style.width  = `${pct}%`;
  document.getElementById("storage-label").textContent = formatBytes(bytes);
}

// ─── Event Delegation ─────────────────────────────────────────────────────────

document.addEventListener("click", async (e) => {
  const target = e.target;

  // ── Toggle add panel ───────────────────────────────────────────────────
  if (target.id === "btn-toggle-add") {
    const next = !state.addPanelOpen;
    setState({ addPanelOpen: next });
    if (next) {
      document.getElementById("snippet-code").focus();
    }
    target.textContent = next ? "✕ CLOSE" : "+ NEW";
    return;
  }

  // ── Tag filter ─────────────────────────────────────────────────────────
  const filterTag = target.closest(".filter-tag");
  if (filterTag) {
    setState({ activeTag: filterTag.dataset.tag });
    return;
  }

  // ── Card actions ───────────────────────────────────────────────────────
  const cardBtn = target.closest(".card-btn");
  if (cardBtn) {
    const card = cardBtn.closest(".snippet-card");
    const id   = card?.dataset?.id;
    if (!id) return;

    const action = cardBtn.dataset.action;

    if (action === "copy") {
      const snippet = state.snippets.find((s) => s.id === id);
      if (snippet) {
        navigator.clipboard.writeText(snippet.code).then(() => {
          cardBtn.classList.add("copy-success");
          showToast("Copied to clipboard!", "success", 1500);
          setTimeout(() => {
            cardBtn.classList.remove("copy-success");
          }, 1500);
        }).catch(() => {
          showToast("Failed to copy", "error");
        });
      }
    }

    if (action === "delete") {
      deleteSnippet(id);
      showToast("Snippet deleted", "success", 1500);
    }
  }

  // ── Expand / collapse code ─────────────────────────────────────────────
  const expandBtn = target.closest(".btn-expand");
  if (expandBtn) {
    const id   = expandBtn.dataset.id;
    const wrap = document.getElementById(`wrap-${id}`);
    if (!wrap) return;
    const expanded = wrap.classList.toggle("expanded");
    expandBtn.textContent = expanded ? "▴ show less" : "▾ show more";
  }
});

// ─── Search ───────────────────────────────────────────────────────────────────

const searchInput    = document.getElementById("search-input");
const btnClearSearch = document.getElementById("btn-clear-search");

searchInput.addEventListener("input", () => {
  const q = searchInput.value;
  btnClearSearch.classList.toggle("visible", q.length > 0);
  setState({ searchQuery: q });
});

btnClearSearch.addEventListener("click", () => {
  searchInput.value = "";
  btnClearSearch.classList.remove("visible");
  setState({ searchQuery: "" });
  searchInput.focus();
});

// ─── Add Snippet Form Logic ───────────────────────────────────────────────────

const codeInput  = document.getElementById("snippet-code");
const titleInput = document.getElementById("snippet-title");
const btnSave    = document.getElementById("btn-save");
const tagsPreview = document.getElementById("auto-tags-preview");

let liveTagTimeout = null;

codeInput.addEventListener("input", () => {
  const hasCode = codeInput.value.trim().length > 0;
  btnSave.disabled = !hasCode;

  // Debounce tag preview
  clearTimeout(liveTagTimeout);
  liveTagTimeout = setTimeout(() => {
    const tags = Categorizer.categorize(codeInput.value);
    renderTagPreview(tags);
  }, 300);
});

// Tab key inserts 2 spaces instead of focusing next element
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const start = codeInput.selectionStart;
    const end = codeInput.selectionEnd;
    codeInput.value = codeInput.value.substring(0, start) + "  " + codeInput.value.substring(end);
    codeInput.selectionStart = codeInput.selectionEnd = start + 2;
  }

  // Ctrl/Cmd + Enter to save
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    btnSave.click();
  }
});

titleInput.addEventListener("keydown", (e) => {
  // Enter in title field moves focus to code area
  if (e.key === "Enter") {
    e.preventDefault();
    codeInput.focus();
  }
});

function renderTagPreview(tags) {
  tagsPreview.innerHTML = tags
    .map((t) => `<span class="tag tag-preview ${tagClass(t)}">${t}</span>`)
    .join("");
}

btnSave.addEventListener("click", async () => {
  const code = codeInput.value.trim();
  if (!code) return;

  if (state.snippets.length >= MAX_SNIPPETS) {
    showToast(`Max ${MAX_SNIPPETS} snippets reached`, "error");
    return;
  }

  const tags    = Categorizer.categorize(code);
  const snippet = createSnippet({
    title:       titleInput.value,
    code,
    tags,
    sourceUrl:   null,
    sourceTitle: null,
  });

  try {
    const updated = [snippet, ...state.snippets];
    await StorageService.saveSnippets(updated);
    const bytes = await StorageService.getStorageBytes();
    
    setState({
      snippets: updated,
      storageBytes: bytes,
      addPanelOpen: false,
    });

    // Reset form
    codeInput.value = "";
    titleInput.value = "";
    tagsPreview.innerHTML = "";
    btnSave.disabled = true;
    document.getElementById("btn-toggle-add").textContent = "+ NEW";

    showToast("Snippet saved!", "success");
  } catch (err) {
    console.error("Failed to save snippet:", err);
    showToast("Failed to save snippet", "error");
  }
});

// ─── Snippet Operations ───────────────────────────────────────────────────────

async function deleteSnippet(id) {
  const updated = state.snippets.filter((s) => s.id !== id);
  await StorageService.saveSnippets(updated);
  const bytes = await StorageService.getStorageBytes();
  setState({ snippets: updated, storageBytes: bytes });
}

// ─── Keyboard Shortcuts (global) ─────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + N → open add panel
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    const btn = document.getElementById("btn-toggle-add");
    const isOpen = state.addPanelOpen;
    setState({ addPanelOpen: !isOpen });
    btn.textContent = isOpen ? "+ NEW" : "✕ CLOSE";
    if (!isOpen) {
      setTimeout(() => codeInput.focus(), 100);
    }
  }

  // Escape → close add panel / clear search
  if (e.key === "Escape") {
    if (state.addPanelOpen) {
      setState({ addPanelOpen: false });
      document.getElementById("btn-toggle-add").textContent = "+ NEW";
      e.preventDefault();
    } else if (searchInput.value) {
      searchInput.value = "";
      btnClearSearch.classList.remove("visible");
      setState({ searchQuery: "" });
      e.preventDefault();
    }
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const snippets = await StorageService.loadSnippets();
    const bytes = await StorageService.getStorageBytes();
    setState({ snippets, storageBytes: bytes });
  } catch (err) {
    console.error("Failed to load snippets:", err);
    showToast("Failed to load snippets", "error");
  }
}

init();
