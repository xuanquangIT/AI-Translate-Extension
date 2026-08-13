/**
 * Page-side UX. This script deliberately keeps its own selection snapshots so
 * popup focus or a later click cannot invalidate an in-flight translation.
 */
(function () {
  if (window.__lingoFluxLoaded) return;
  window.__lingoFluxLoaded = true;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE', 'KBD', 'SAMP']);
  const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
  const snapshots = new Map();
  let latestSnapshotId = '';
  let selectionEnabled = true;
  let displayMode = 'badge';
  let floatingButton = null;

  chrome.storage.local.get(['enableSelection', 'translationDisplayMode']).then((data) => {
    selectionEnabled = data.enableSelection !== false;
    displayMode = data.translationDisplayMode || 'badge';
  }).catch(() => {});

  function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function selectionTextWithoutExtensionUi(range, fallback) {
    try {
      const fragment = range.cloneContents();
      fragment.querySelectorAll?.('.lingoflux-translation-badge, .lingoflux-replaced, .lingoflux-page-translated').forEach((node) => node.remove());
      const holder = document.createElement('div'); holder.appendChild(fragment);
      return cleanText(holder.textContent) || cleanText(fallback);
    } catch (_) {
      return cleanText(fallback);
    }
  }

  function rangeIsConnected(range) {
    const node = range?.commonAncestorContainer;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.isConnected);
  }

  function pruneSnapshots() {
    const now = Date.now();
    for (const [id, snapshot] of snapshots) {
      if (now - snapshot.createdAt > SNAPSHOT_TTL_MS || !rangeIsConnected(snapshot.range)) snapshots.delete(id);
    }
    while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
    if (!snapshots.has(latestSnapshotId)) latestSnapshotId = [...snapshots.keys()].at(-1) || '';
  }

  function captureCurrentSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const text = selectionTextWithoutExtensionUi(range, selection.toString());
    if (!text || !rangeIsConnected(range)) return null;
    const id = `selection_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    snapshots.set(id, { id, text, range: range.cloneRange(), createdAt: Date.now() });
    latestSnapshotId = id;
    pruneSnapshots();
    return snapshots.get(id);
  }

  function getSelectionSnapshot() {
    const current = captureCurrentSelection();
    if (current) return current;
    pruneSnapshots();
    return snapshots.get(latestSnapshotId) || null;
  }

  function getSnapshotRange(selectionId) {
    pruneSnapshots();
    const snapshot = snapshots.get(selectionId || latestSnapshotId);
    return snapshot && rangeIsConnected(snapshot.range) ? snapshot.range.cloneRange() : null;
  }

  function showToast(message, type = 'info', persistent = false) {
    document.getElementById('lingoflux-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'lingoflux-toast';
    toast.textContent = message;
    toast.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:360px;padding:12px 14px;border-radius:10px;background:${type === 'error' ? '#b42318' : type === 'loading' ? '#1d4ed8' : '#166534'};color:#fff;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.24);`;
    document.documentElement.appendChild(toast);
    if (!persistent) setTimeout(() => toast.remove(), 3500);
  }

  function createControl(label, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.style.cssText = 'border:0;background:transparent;color:#64748b;cursor:pointer;font:600 14px/1 system-ui;padding:2px 4px;';
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
    return button;
  }

  function translationContainer(translation, originalHtml, mode) {
    const wrapper = document.createElement('span');
    wrapper.className = mode === 'replace' ? 'lingoflux-replaced' : 'lingoflux-translation-badge';
    wrapper.style.cssText = 'display:inline;vertical-align:baseline;margin-left:4px;padding:2px 7px;border:1px solid #bfdbfe;border-radius:6px;background:#eff6ff;color:#1d4ed8;font:500 inherit;line-height:inherit;white-space:pre-wrap;word-break:break-word;';
    if (originalHtml !== undefined) wrapper.dataset.originalHtml = originalHtml;
    const text = document.createElement('span');
    text.textContent = translation;
    const copy = createControl('⧉', 'Copy translation', () => navigator.clipboard.writeText(translation).then(() => showToast('Translation copied.')).catch(() => showToast('Unable to copy.', 'error')));
    const close = createControl('×', mode === 'replace' ? 'Restore original text' : 'Remove translation', () => {
      if (mode !== 'replace') return wrapper.remove();
      const holder = document.createElement('span');
      holder.innerHTML = wrapper.dataset.originalHtml || '';
      wrapper.replaceWith(...holder.childNodes);
    });
    wrapper.append(text, copy, close);
    return wrapper;
  }

  function insertTranslation(translation, selectionId) {
    const range = getSnapshotRange(selectionId);
    if (!range) throw new Error('The original selection is no longer available. Select the text again.');
    if (displayMode === 'replace') {
      const holder = document.createElement('div');
      holder.appendChild(range.cloneContents());
      const wrapper = translationContainer(translation, holder.innerHTML, 'replace');
      range.deleteContents();
      range.insertNode(wrapper);
    } else {
      const wrapper = translationContainer(translation, undefined, 'badge');
      range.collapse(false);
      range.insertNode(wrapper);
    }
    window.getSelection()?.removeAllRanges();
  }

  function isSkippableNode(node) {
    const element = node?.parentElement;
    if (!element || SKIP_TAGS.has(element.tagName)) return true;
    if (element.closest("[contenteditable='true'], [translate='no'], .notranslate, .lingoflux-translation-badge, .lingoflux-replaced, .lingoflux-page-translated")) return true;
    const style = window.getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  function extractPageSegments() {
    const segments = [];
    const nodeMap = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.textContent || '';
        if (!text.trim() || isSkippableNode(node)) return NodeFilter.FILTER_REJECT;
        const core = text.trim();
        if (core.length < 3 || core.length > 2000 || /^\d+$/.test(core) || /^https?:\/\//i.test(core)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode() && segments.length < 200) {
      const node = walker.currentNode;
      const id = `t${segments.length}`;
      segments.push({ id, text: node.textContent.trim() });
      nodeMap.set(id, node);
    }
    window.__lingoFluxNodeMap = nodeMap;
    return segments;
  }

  function applyPageTranslations(translations) {
    const nodeMap = window.__lingoFluxNodeMap;
    if (!nodeMap) throw new Error('Page translation session expired. Extract the page again.');
    for (const item of Array.isArray(translations) ? translations : []) {
      const node = nodeMap.get(item?.id);
      if (!node?.parentElement || typeof item?.text !== 'string') continue;
      const original = node.textContent;
      const leading = original.match(/^\s*/)?.[0] || '';
      const trailing = original.match(/\s*$/)?.[0] || '';
      const wrapper = document.createElement('span');
      wrapper.className = 'lingoflux-page-translated';
      wrapper.dataset.original = original;
      wrapper.title = original.trim();
      wrapper.textContent = `${leading}${item.text.trim()}${trailing}`;
      node.parentElement.replaceChild(wrapper, node);
    }
  }

  function ensureFloatingButton() {
    if (floatingButton?.isConnected) return floatingButton;
    floatingButton = document.createElement('button');
    floatingButton.id = 'lingoflux-translate-button';
    floatingButton.type = 'button';
    floatingButton.textContent = 'Translate';
    floatingButton.style.cssText = 'position:fixed;z-index:2147483647;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#111827;color:#fff;padding:8px 13px;box-shadow:0 12px 26px rgba(15,23,42,.32);font:650 12px system-ui;letter-spacing:.01em;cursor:pointer;display:none;';
    floatingButton.addEventListener('mousedown', (event) => event.preventDefault());
    floatingButton.addEventListener('click', () => translateSelection());
    document.documentElement.appendChild(floatingButton);
    return floatingButton;
  }

  function hideFloatingButton() { if (floatingButton) floatingButton.style.display = 'none'; }

  function showFloatingButton(range) {
    if (!selectionEnabled) return;
    const rects = [...range.getClientRects()];
    const rect = rects.at(-1) || range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const button = ensureFloatingButton();
    button.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 112))}px`;
    button.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 44))}px`;
    button.style.display = 'block';
  }

  async function translateSelection(requestSnapshot = null) {
    const snapshot = requestSnapshot || getSelectionSnapshot();
    if (!snapshot?.text) return;
    hideFloatingButton();
    showToast('Translating…', 'loading', true);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE_TEXT', payload: { text: snapshot.text } });
      document.getElementById('lingoflux-toast')?.remove();
      if (!result?.ok) throw new Error(result?.error || 'Translation failed.');
      insertTranslation(result.translation, snapshot.id);
      showToast('Translated.');
    } catch (error) {
      document.getElementById('lingoflux-toast')?.remove();
      showToast(error?.message || 'Translation failed.', 'error');
    }
  }

  document.addEventListener('mouseup', (event) => {
    if (!selectionEnabled || event.target.closest('#lingoflux-translate-button')) return;
    setTimeout(() => {
      // Never revive an old snapshot for the floating button. Snapshots exist
      // only so a popup-triggered request can insert at its original range.
      const snapshot = captureCurrentSelection();
      if (snapshot) showFloatingButton(snapshot.range); else hideFloatingButton();
    }, 0);
  });
  document.addEventListener('mousedown', (event) => { if (!event.target.closest('#lingoflux-translate-button')) hideFloatingButton(); });
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !cleanText(selection.toString())) hideFloatingButton();
  });
  document.addEventListener('keydown', (event) => {
    if (!selectionEnabled || event.repeat || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.matches?.('input, textarea, select, button, [contenteditable="true"]')) return;
    if (event.key !== 't' && event.key !== 'T') return;

    const snapshot = captureCurrentSelection();
    if (!snapshot) return;
    event.preventDefault();
    translateSelection(snapshot);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        switch (message?.type) {
          case 'SET_SELECTION_ENABLED': selectionEnabled = Boolean(message.enabled); if (!selectionEnabled) hideFloatingButton(); sendResponse({ ok: true }); break;
          case 'SET_DISPLAY_MODE': displayMode = message.mode === 'replace' ? 'replace' : 'badge'; sendResponse({ ok: true }); break;
          case 'SHOW_TOAST': showToast(message.message, message.toastType, message.persistent); sendResponse({ ok: true }); break;
          case 'GET_SELECTION': { const snapshot = getSelectionSnapshot(); sendResponse({ ok: true, text: snapshot?.text || '', selectionId: snapshot?.id || '' }); break; }
          case 'INSERT_TRANSLATION': insertTranslation(message.translation, message.selectionId); sendResponse({ ok: true }); break;
          case 'TRANSLATE_PAGE_EXTRACT': sendResponse({ ok: true, segments: extractPageSegments() }); break;
          case 'TRANSLATE_PAGE_APPLY': applyPageTranslations(message.translations); sendResponse({ ok: true }); break;
          default: sendResponse({ ok: false, error: 'Unknown message type.' });
        }
      } catch (error) { sendResponse({ ok: false, error: error?.message || String(error) }); }
    })();
    return true;
  });
})();
