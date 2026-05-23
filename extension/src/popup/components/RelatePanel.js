/**
 * RelatePanel Component
 *
 * Displays similar code snippets based on semantic matching.
 * Triggered by user clicking "Relate" on a snippet.
 *
 * Flow:
 *  1. User selects code on active page
 *  2. Clicks "Relate" button in popup
 *  3. Background worker computes embedding of selected code
 *  4. RelatePanel queries IndexedDB for similar snippets
 *  5. Renders top-5 matches with similarity scores
 *
 * UI:
 *  - Collapsible panel inside popup
 *  - Shows match score (0-100%)
 *  - Snippet preview with syntax highlighting
 *  - "Copy" and "Use in Code" buttons
 */

export class RelatePanel {
  constructor(container) {
    this.container = container;
    this.isVisible = false;
    this.matches = [];
    this.selectedMatch = null;
  }

  /**
   * Display related snippets panel.
   *
   * @param {Array<{uuid, title, code, tags, score}>} matches
   */
  render(matches = []) {
    this.matches = matches || [];

    if (matches.length === 0) {
      this._renderEmpty();
      return;
    }

    const html = `
      <div class="relate-panel" role="region" aria-label="Related Snippets">
        <div class="relate-header">
          <h3 class="relate-title">🧲 Related Snippets</h3>
          <button class="relate-close" aria-label="Close">×</button>
        </div>

        <div class="relate-results">
          ${matches
            .map(
              (match, idx) => `
            <div class="relate-match-item" data-uuid="${match.uuid}">
              <div class="relate-match-header">
                <span class="relate-score">${(match.score * 100).toFixed(0)}%</span>
                <span class="relate-title-text">${this._escapeHtml(match.title)}</span>
              </div>

              <div class="relate-tags">
                ${(match.tags || [])
                  .map(
                    (tag) => `
                  <span class="relate-tag">${tag}</span>
                `
                  )
                  .join('')}
              </div>

              <pre class="relate-code-preview"><code>${this._escapeHtml(
                this._truncateCode(match.code, 200)
              )}</code></pre>

              <div class="relate-actions">
                <button 
                  class="relate-action-btn relate-copy"
                  data-uuid="${match.uuid}"
                  title="Copy to clipboard">
                  📋 Copy
                </button>
                <button 
                  class="relate-action-btn relate-use"
                  data-uuid="${match.uuid}"
                  title="Insert into current page">
                  ✨ Use
                </button>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.isVisible = true;

    // Attach event listeners
    this._attachListeners();
  }

  /**
   * Hide the relate panel.
   */
  hide() {
    this.container.innerHTML = '';
    this.isVisible = false;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  _renderEmpty() {
    const html = `
      <div class="relate-panel relate-empty">
        <div class="relate-header">
          <h3 class="relate-title">🧲 Related Snippets</h3>
          <button class="relate-close" aria-label="Close">×</button>
        </div>
        <div class="relate-empty-state">
          <p>No related snippets found.</p>
          <small>Build your library with more code samples for better matches!</small>
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this.isVisible = true;
    this._attachListeners();
  }

  _attachListeners() {
    // Close button
    const closeBtn = this.container.querySelector('.relate-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Copy buttons
    this.container.querySelectorAll('.relate-copy').forEach((btn) => {
      btn.addEventListener('click', (e) => this._handleCopy(e));
    });

    // Use buttons
    this.container.querySelectorAll('.relate-use').forEach((btn) => {
      btn.addEventListener('click', (e) => this._handleUse(e));
    });

    // Match item click for preview
    this.container.querySelectorAll('.relate-match-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (
          !e.target.closest('.relate-actions') &&
          !e.target.closest('.relate-close')
        ) {
          this.selectedMatch = item.dataset.uuid;
          this._highlightMatch(this.selectedMatch);
        }
      });
    });
  }

  async _handleCopy(event) {
    event.preventDefault();
    event.stopPropagation();

    const uuid = event.currentTarget.dataset.uuid;
    const match = this.matches.find((m) => m.uuid === uuid);

    if (match) {
      try {
        await navigator.clipboard.writeText(match.code);

        // Show toast
        this._showToast('Copied to clipboard! 📋', 'success');

        // Animate button
        event.currentTarget.textContent = '✓ Copied';
        setTimeout(() => {
          event.currentTarget.textContent = '📋 Copy';
        }, 2000);
      } catch (error) {
        this._showToast('Failed to copy', 'error');
      }
    }
  }

  async _handleUse(event) {
    event.preventDefault();
    event.stopPropagation();

    const uuid = event.currentTarget.dataset.uuid;
    const match = this.matches.find((m) => m.uuid === uuid);

    if (match) {
      // Send message to content script to inject code
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'INJECT_SNIPPET',
            payload: { code: match.code },
          });

          this._showToast('Snippet ready to use! ✨', 'success');
        }
      });
    }
  }

  _highlightMatch(uuid) {
    this.container
      .querySelectorAll('.relate-match-item')
      .forEach((item) => {
        item.classList.toggle('selected', item.dataset.uuid === uuid);
      });
  }

  _truncateCode(code, maxLength) {
    if (code.length <= maxLength) return code;
    return code.substring(0, maxLength) + '...';
  }

  _escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  _showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `relate-toast relate-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('relate-toast-visible');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('relate-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// ─── CSS Styles for RelatePanel ───────────────────────────────────────────────

export const relatePanelStyles = `
.relate-panel {
  border-top: 1px solid var(--accent);
  padding: 12px;
  background: rgba(45, 255, 154, 0.03);
  border-radius: 6px;
  margin-top: 12px;
  animation: slideIn 0.3s ease;
}

.relate-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.relate-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.relate-close {
  background: none;
  border: none;
  color: var(--txt-primary);
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.relate-close:hover {
  opacity: 1;
}

.relate-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.relate-match-item {
  background: var(--bg-input);
  border: 1px solid var(--bg-surface);
  border-radius: 4px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.relate-match-item:hover {
  border-color: var(--accent);
  background: rgba(45, 255, 154, 0.05);
}

.relate-match-item.selected {
  border-color: var(--accent);
  background: rgba(45, 255, 154, 0.1);
}

.relate-match-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}

.relate-score {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: rgba(45, 255, 154, 0.2);
  padding: 2px 6px;
  border-radius: 3px;
  min-width: 40px;
  text-align: center;
}

.relate-title-text {
  font-size: 12px;
  color: var(--txt-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.relate-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}

.relate-tag {
  font-size: 10px;
  padding: 2px 4px;
  background: rgba(45, 255, 154, 0.15);
  color: var(--txt-code);
  border-radius: 2px;
}

.relate-code-preview {
  font-size: 10px;
  background: var(--bg-base);
  color: var(--txt-code);
  padding: 6px;
  border-radius: 3px;
  margin: 6px 0;
  overflow-x: auto;
  max-height: 80px;
  border: 1px solid var(--bg-surface);
}

.relate-code-preview code {
  font-family: var(--font-mono);
  line-height: 1.3;
}

.relate-actions {
  display: flex;
  gap: 6px;
}

.relate-action-btn {
  flex: 1;
  padding: 4px 8px;
  font-size: 10px;
  background: rgba(45, 255, 154, 0.1);
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
}

.relate-action-btn:hover {
  background: rgba(45, 255, 154, 0.2);
  transform: translateY(-1px);
}

.relate-empty-state {
  text-align: center;
  padding: 16px;
  color: var(--txt-primary);
}

.relate-empty-state p {
  margin: 0 0 6px;
  font-size: 12px;
}

.relate-empty-state small {
  font-size: 10px;
  color: var(--txt-primary);
  opacity: 0.6;
}

.relate-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 10px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--txt-primary);
  font-size: 12px;
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s;
  z-index: 1000;
  pointer-events: none;
}

.relate-toast-visible {
  opacity: 1;
  transform: translateY(0);
}

.relate-toast-success {
  border-color: var(--accent);
}

.relate-toast-error {
  border-color: #ff6b6b;
  color: #ff6b6b;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`;
