/**
 * Page-side UX: selection snapshots, floating button, badge/replace rendering,
 * and page segment extract/apply.
 *
 * CLASSIC SCRIPT (not an ES module): it cannot import from `src/shared`.
 * - Message type strings mirror CONTENT_MESSAGES in src/shared/messages.js.
 * - `cleanText` mirrors sanitizeIncomingText in src/shared/text.js.
 * tests/contract/content-script.test.js enforces both.
 *
 * Snapshots exist so popup focus or a later click cannot invalidate an
 * in-flight translation. Provider output is always rendered via textContent.
 */
(function () {
  if (window.__lingoFluxLoaded) return;
  window.__lingoFluxLoaded = true;

  const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
  const snapshots = new Map();
  let latestSnapshotId = '';
  let selectionEnabled = true;
  let displayMode = 'badge';
  let floatingButton = null;

  chrome.storage.local
    .get(['enableSelection', 'translationDisplayMode'])
    .then((data) => {
      selectionEnabled = data.enableSelection !== false;
      displayMode = data.translationDisplayMode || 'badge';
    })
    .catch(() => {});

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function selectionTextWithoutExtensionUi(range, fallback) {
    try {
      const fragment = range.cloneContents();
      fragment.querySelectorAll?.('.lingoflux-translation-badge, .lingoflux-replaced').forEach((node) => node.remove());
      const holder = document.createElement('div');
      holder.appendChild(fragment);
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
    button.style.cssText =
      'border:0;background:transparent;color:#64748b;cursor:pointer;font:600 14px/1 system-ui;padding:2px 4px;';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function translationContainer(translation, originalHtml, mode) {
    const wrapper = document.createElement('span');
    wrapper.className = mode === 'replace' ? 'lingoflux-replaced' : 'lingoflux-translation-badge';
    wrapper.style.cssText =
      'display:inline;vertical-align:baseline;margin-left:4px;padding:2px 7px;border:1px solid #bfdbfe;border-radius:6px;background:#eff6ff;color:#1d4ed8;font:500 inherit;line-height:inherit;white-space:pre-wrap;word-break:break-word;';
    if (originalHtml !== undefined) wrapper.dataset.originalHtml = originalHtml;
    const text = document.createElement('span');
    text.textContent = translation;
    const copy = createControl('⧉', 'Copy translation', () =>
      navigator.clipboard
        .writeText(translation)
        .then(() => showToast('Translation copied.'))
        .catch(() => showToast('Unable to copy.', 'error'))
    );
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

  // ------------------------------------------------------------------ whole-page translation
  //
  // A live session per tab: text on screen (plus a prefetch margin) is translated first, the rest as
  // the user scrolls, and new or re-rendered text (SPA updates, infinite scroll, virtualized lists)
  // is picked up by a MutationObserver. Text is replaced in place through `nodeValue`, so pages that
  // own their DOM (React, Vue, …) keep their node references; originals are kept for restore.
  // Requests are packed by characters, identical strings are sent once, and every translation is
  // cached by source text so re-rendered nodes are re-applied without another provider call.

  const PAGE_EXCLUDE_SELECTOR = [
    'script',
    'style',
    'noscript',
    'template',
    'iframe',
    'textarea',
    'input',
    'select',
    'option',
    'code',
    'pre',
    'kbd',
    'samp',
    'svg',
    'math',
    '[contenteditable]:not([contenteditable="false"])',
    '[translate="no"]',
    '.notranslate',
    '.lingoflux-translation-badge',
    '.lingoflux-replaced',
    '#lingoflux-toast',
    '#lingoflux-translate-button'
  ].join(', ');
  const PAGE_BATCH_MAX_CHARS = 2500;
  const PAGE_BATCH_MAX_SEGMENTS = 40;
  const PAGE_SEGMENT_MAX_CHARS = 2000;
  const PAGE_MAX_IN_FLIGHT = 2;
  const PAGE_FLUSH_DELAY_MS = 200;
  const PAGE_MUTATION_DELAY_MS = 120;
  const PAGE_MAX_ATTEMPTS = 2;
  const PAGE_ERROR_PAUSE_MS = 8000;
  const PAGE_PREFETCH_MARGIN = '600px 0px';
  const PAGE_RECORD_PRUNE_AT = 3000;
  const PAGE_MAX_REAPPLY = 20;
  const PAGE_MAX_NODE_REQUESTS = 4; // a node whose text keeps changing (clock, counter) stops being sent
  const PAGE_CACHE_MAX = 5000;
  const PAGE_MAX_RATE_LIMIT_PAUSE_MS = 60_000; // longer blocks (hourly/daily quota) are reported, not waited out
  const PAGE_MAX_RATE_LIMIT_STREAK = 5;

  const page = {
    active: false,
    session: 0,
    options: null,
    optionsKey: '',
    cache: new Map(), // source text → translation (kept across restore for the same options)
    records: new Map(), // Text node → { original, translated }
    watched: new Map(), // Element → Set<Text> waiting to come into view
    queued: new Set(), // Text nodes queued or in flight
    queue: [], // { node, source }
    waiting: new Map(), // source text in flight → Text nodes to apply it to
    attempts: new Map(), // source text → failed attempts
    requests: new WeakMap(), // Text node → times its text was sent
    rateLimitedUntil: 0,
    rateLimitStreak: 0,
    inFlight: 0,
    flushTimer: 0,
    pausedUntil: 0,
    translatedCount: 0,
    announced: false,
    intersection: null,
    mutation: null,
    mutationRoots: new Set(),
    mutationTimer: 0
  };

  function pageSourceText(node) {
    const core = (node.nodeValue || '').trim();
    if (core.length < 2 || core.length > PAGE_SEGMENT_MAX_CHARS) return '';
    if (!/\p{L}/u.test(core)) return ''; // numbers, punctuation, symbols, emoji only
    if (/^(https?:\/\/|www\.)\S+$/i.test(core)) return '';
    return core;
  }

  function isPageTextCandidate(node) {
    const parent = node.parentElement;
    return Boolean(parent) && !parent.closest(PAGE_EXCLUDE_SELECTOR);
  }

  function setPageToast(message, type, persistent) {
    const current = document.getElementById('lingoflux-toast');
    if (current?.dataset.page === type && persistent) {
      current.textContent = message;
      return;
    }
    showToast(message, type, persistent);
    const toast = document.getElementById('lingoflux-toast');
    if (toast) toast.dataset.page = type;
  }

  function clearPageToast() {
    const toast = document.getElementById('lingoflux-toast');
    if (toast?.dataset.page) toast.remove();
  }

  function friendlyPageError(message) {
    const text = String(message || 'Page translation failed.');
    if (/\b429\b|rate.?limit|quota|too many requests/i.test(text)) {
      return 'The provider rate limit was reached. LingoFlux will continue in a few seconds.';
    }
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  }

  function updatePageProgress() {
    if (!page.active) return;
    const rateLimitedFor = page.rateLimitedUntil - Date.now();
    if (rateLimitedFor > 0) {
      setPageToast(`Provider rate limit reached. Continuing in ${Math.ceil(rateLimitedFor / 1000)}s…`, 'loading', true);
    } else if (page.inFlight || page.queue.length) {
      setPageToast(`Translating page… ${page.translatedCount} translated`, 'loading', true);
    } else if (!page.announced && page.translatedCount) {
      page.announced = true;
      setPageToast('Page translated. More text is translated as you scroll.', 'info', false);
    } else {
      clearPageToast();
    }
  }

  function applyPageTranslation(node, source, translation) {
    if (!node.isConnected) return;
    const current = node.nodeValue || '';
    if (current.trim() !== source) return; // the page changed this text meanwhile
    const leading = current.match(/^\s*/)[0];
    const trailing = current.match(/\s*$/)[0];
    const translated = `${leading}${translation}${trailing}`;
    const prior = page.records.get(node);
    if (!prior) page.translatedCount += 1;
    // Keep the first original so restore never "restores" to a translation.
    const original = prior && prior.translated === current ? prior.original : current;
    page.records.set(node, { original, translated, reapplied: 0 });
    if (current !== translated) node.nodeValue = translated;
  }

  /** `display: contents` elements have no box and never intersect: observe the nearest ancestor that does. */
  function pageObserveTarget(element) {
    let target = element;
    while (target.parentElement && target !== document.body && getComputedStyle(target).display === 'contents') {
      target = target.parentElement;
    }
    return target;
  }

  function watchPageNode(node) {
    if (!node.parentElement || !page.intersection) return;
    const element = pageObserveTarget(node.parentElement);
    let nodes = page.watched.get(element);
    if (!nodes) {
      nodes = new Set();
      page.watched.set(element, nodes);
      page.intersection.observe(element);
    }
    nodes.add(node);
  }

  function considerPageTextNode(node) {
    const record = page.records.get(node);
    if (record) {
      if (node.nodeValue === record.translated) return;
      if (node.nodeValue === record.original) {
        // The page re-rendered the original text: re-apply, but stop if the page keeps fighting back.
        if (record.reapplied < PAGE_MAX_REAPPLY) {
          record.reapplied += 1;
          node.nodeValue = record.translated;
        }
        return;
      }
      page.records.delete(node); // the page wrote new text: translate it as new
    }
    if (page.queued.has(node)) return;
    const source = pageSourceText(node);
    if (!source) return;
    const cached = page.cache.get(source);
    if (cached !== undefined) return applyPageTranslation(node, source, cached);
    if ((page.attempts.get(source) || 0) >= PAGE_MAX_ATTEMPTS) return;
    if ((page.requests.get(node) || 0) >= PAGE_MAX_NODE_REQUESTS) return;
    watchPageNode(node);
  }

  function scanForPage(root) {
    if (!page.active || !root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (isPageTextCandidate(root)) considerPageTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(PAGE_EXCLUDE_SELECTOR)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        return node.matches(PAGE_EXCLUDE_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()) considerPageTextNode(walker.currentNode);
  }

  function enqueuePageNode(node) {
    if (!page.active || !node.isConnected || page.queued.has(node)) return;
    if (page.records.get(node)?.translated === node.nodeValue) return; // translated meanwhile from cache
    const source = pageSourceText(node);
    if (!source) return;
    const cached = page.cache.get(source);
    if (cached !== undefined) return applyPageTranslation(node, source, cached);
    const requests = page.requests.get(node) || 0;
    if (requests >= PAGE_MAX_NODE_REQUESTS) return;
    page.requests.set(node, requests + 1);
    page.queue.push({ node, source });
    page.queued.add(node);
    schedulePageFlush();
  }

  function onPageIntersection(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const nodes = page.watched.get(entry.target);
      page.watched.delete(entry.target);
      page.intersection?.unobserve(entry.target);
      nodes?.forEach(enqueuePageNode);
    }
  }

  function schedulePageFlush(delay = PAGE_FLUSH_DELAY_MS) {
    if (!page.active || page.flushTimer) return;
    const wait = Math.max(delay, page.pausedUntil - Date.now());
    page.flushTimer = setTimeout(() => {
      page.flushTimer = 0;
      flushPageQueue();
    }, wait);
  }

  function flushPageQueue() {
    if (!page.active) return;
    if (page.pausedUntil > Date.now()) return schedulePageFlush(0);
    while (page.inFlight < PAGE_MAX_IN_FLIGHT && page.queue.length) {
      const groups = new Map(); // source → nodes
      let chars = 0;
      while (page.queue.length) {
        const item = page.queue[0];
        if (!item.node.isConnected) {
          page.queue.shift();
          page.queued.delete(item.node);
          continue;
        }
        const cached = page.cache.get(item.source);
        if (cached !== undefined) {
          page.queue.shift();
          page.queued.delete(item.node);
          applyPageTranslation(item.node, item.source, cached);
          continue;
        }
        const inFlightNodes = page.waiting.get(item.source);
        if (inFlightNodes) {
          page.queue.shift();
          inFlightNodes.push(item.node); // same text already requested: share the answer
          continue;
        }
        const isNew = !groups.has(item.source);
        const full = groups.size >= PAGE_BATCH_MAX_SEGMENTS || chars + item.source.length > PAGE_BATCH_MAX_CHARS;
        if (isNew && groups.size && full) break;
        page.queue.shift();
        if (isNew) {
          groups.set(item.source, []);
          chars += item.source.length;
        }
        groups.get(item.source).push(item.node);
      }
      if (!groups.size) break;
      sendPageBatch(groups);
    }
    updatePageProgress();
  }

  async function sendPageBatch(groups) {
    const session = page.session;
    const sources = [...groups.keys()];
    const segments = sources.map((text, index) => ({ id: `s${index}`, text }));
    groups.forEach((nodes, source) => page.waiting.set(source, nodes));
    page.inFlight += 1;

    const translated = new Map();
    let failure = null;
    let retryAfterMs = 0;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_PAGE',
        payload: { ...page.options, segments }
      });
      if (!response?.ok) throw new Error(response?.error || 'Page translation failed.');
      retryAfterMs = Number(response.retryAfterMs) || 0; // every model was rate limited: wait, then retry
      const sourceById = new Map(segments.map((segment) => [segment.id, segment.text]));
      for (const item of response.translations || []) {
        const source = sourceById.get(item?.id);
        if (source && typeof item.text === 'string' && item.text.trim()) translated.set(source, item.text.trim());
      }
    } catch (error) {
      failure = error;
    }
    if (session !== page.session) return; // restored or restarted meanwhile

    page.inFlight -= 1;
    if (retryAfterMs) {
      page.rateLimitStreak += 1;
      if (retryAfterMs > PAGE_MAX_RATE_LIMIT_PAUSE_MS || page.rateLimitStreak > PAGE_MAX_RATE_LIMIT_STREAK) {
        failure = new Error(
          'The provider quota is used up for now. Try again later or choose another model, then click Translate page.'
        );
        failure.final = true;
        retryAfterMs = 0;
      }
    } else if (!failure) {
      page.rateLimitStreak = 0;
    }
    for (const source of sources) {
      const nodes = page.waiting.get(source) || [];
      page.waiting.delete(source);
      const translation = translated.get(source);
      if (translation !== undefined) rememberPageTranslation(source, translation);
      for (const node of nodes) {
        page.queued.delete(node);
        if (!node.isConnected) continue;
        if ((node.nodeValue || '').trim() !== source) {
          considerPageTextNode(node); // the page changed this text while it was in flight
        } else if (translation !== undefined) {
          applyPageTranslation(node, source, translation);
        }
      }
      if (translation === undefined) {
        // A rate-limited batch is not the text's fault: retry it without spending an attempt.
        const attempts = (page.attempts.get(source) || 0) + (retryAfterMs ? 0 : 1);
        page.attempts.set(source, attempts);
        if (attempts < PAGE_MAX_ATTEMPTS) {
          for (const node of nodes) {
            if (!node.isConnected || (node.nodeValue || '').trim() !== source) continue;
            if (retryAfterMs) page.requests.set(node, Math.max(0, (page.requests.get(node) || 1) - 1));
            watchPageNode(node); // retried while visible
          }
        }
      }
    }
    if (failure) {
      page.pausedUntil = Date.now() + PAGE_ERROR_PAUSE_MS;
      page.rateLimitedUntil = 0;
      setPageToast(failure.final ? failure.message : friendlyPageError(failure.message), 'error', false);
    } else if (retryAfterMs) {
      page.rateLimitedUntil = Math.max(page.rateLimitedUntil, Date.now() + retryAfterMs);
      page.pausedUntil = Math.max(page.pausedUntil, page.rateLimitedUntil);
      setTimeout(() => {
        if (session === page.session) updatePageProgress();
      }, retryAfterMs + 100);
    }
    if (page.queue.length) schedulePageFlush();
    if (!failure) updatePageProgress();
  }

  function rememberPageTranslation(source, translation) {
    page.cache.set(source, translation);
    if (page.cache.size > PAGE_CACHE_MAX) page.cache.delete(page.cache.keys().next().value);
  }

  function onPageMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') page.mutationRoots.add(mutation.target);
      else mutation.addedNodes.forEach((node) => page.mutationRoots.add(node));
    }
    if (!page.mutationTimer) page.mutationTimer = setTimeout(processPageMutations, PAGE_MUTATION_DELAY_MS);
  }

  function processPageMutations() {
    page.mutationTimer = 0;
    const roots = [...page.mutationRoots];
    page.mutationRoots.clear();
    for (const root of roots) if (root.isConnected) scanForPage(root);
    if (page.records.size > PAGE_RECORD_PRUNE_AT) {
      for (const node of page.records.keys()) if (!node.isConnected) page.records.delete(node);
    }
    if (page.watched.size > PAGE_RECORD_PRUNE_AT) {
      for (const element of page.watched.keys()) {
        if (element.isConnected) continue;
        page.watched.delete(element); // detached elements never intersect again
        page.intersection?.unobserve(element);
      }
    }
  }

  function restorePage() {
    page.active = false;
    page.session += 1;
    page.intersection?.disconnect();
    page.mutation?.disconnect();
    page.intersection = null;
    page.mutation = null;
    clearTimeout(page.flushTimer);
    clearTimeout(page.mutationTimer);
    page.flushTimer = 0;
    page.mutationTimer = 0;
    page.queue = [];
    page.queued.clear();
    page.watched.clear();
    page.waiting.clear();
    page.attempts.clear();
    page.mutationRoots.clear();
    page.inFlight = 0;
    page.pausedUntil = 0;
    page.rateLimitedUntil = 0;
    page.rateLimitStreak = 0;
    page.requests = new WeakMap();
    page.announced = false;

    let restored = 0;
    for (const [node, record] of page.records) {
      if (node.isConnected && node.nodeValue === record.translated) {
        node.nodeValue = record.original;
        restored += 1;
      }
    }
    page.records.clear();
    page.translatedCount = 0;
    clearPageToast();
    return restored;
  }

  function startPageTranslation(options) {
    if (!document.body) throw new Error('This page has no translatable content.');
    const nextOptions = {
      fromLang: options?.fromLang,
      toLang: options?.toLang,
      model: options?.model,
      modelProvider: options?.modelProvider
    };
    const optionsKey = JSON.stringify(nextOptions);
    if (page.active && optionsKey === page.optionsKey) {
      // Same request again: retry failed text and pick up anything missed.
      page.attempts.clear();
      page.requests = new WeakMap();
      page.pausedUntil = 0;
      page.rateLimitedUntil = 0;
      page.rateLimitStreak = 0;
      scanForPage(document.body);
      updatePageProgress();
      return { pending: page.watched.size + page.queue.length };
    }
    if (page.active) restorePage();
    if (optionsKey !== page.optionsKey) page.cache.clear();

    page.active = true;
    page.session += 1;
    page.options = nextOptions;
    page.optionsKey = optionsKey;
    page.intersection = new IntersectionObserver(onPageIntersection, { rootMargin: PAGE_PREFETCH_MARGIN });
    page.mutation = new MutationObserver(onPageMutations);
    page.mutation.observe(document.body, { childList: true, subtree: true, characterData: true });
    scanForPage(document.body);
    setPageToast('Translating page…', 'loading', true);
    if (!page.watched.size && !page.translatedCount) {
      restorePage();
      throw new Error('No translatable text was found on this page.');
    }
    return { pending: page.watched.size };
  }

  function ensureFloatingButton() {
    if (floatingButton?.isConnected) return floatingButton;
    floatingButton = document.createElement('button');
    floatingButton.id = 'lingoflux-translate-button';
    floatingButton.type = 'button';
    floatingButton.textContent = 'Translate';
    floatingButton.style.cssText =
      'position:fixed;z-index:2147483647;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:#111827;color:#fff;padding:8px 13px;box-shadow:0 12px 26px rgba(15,23,42,.32);font:650 12px system-ui;letter-spacing:.01em;cursor:pointer;display:none;';
    floatingButton.addEventListener('mousedown', (event) => event.preventDefault());
    floatingButton.addEventListener('click', () => translateSelection());
    document.documentElement.appendChild(floatingButton);
    return floatingButton;
  }

  function hideFloatingButton() {
    if (floatingButton) floatingButton.style.display = 'none';
  }

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
      if (snapshot) showFloatingButton(snapshot.range);
      else hideFloatingButton();
    }, 0);
  });
  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest('#lingoflux-translate-button')) hideFloatingButton();
  });
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
          case 'SET_SELECTION_ENABLED':
            selectionEnabled = Boolean(message.enabled);
            if (!selectionEnabled) hideFloatingButton();
            sendResponse({ ok: true });
            break;
          case 'SET_DISPLAY_MODE':
            displayMode = message.mode === 'replace' ? 'replace' : 'badge';
            sendResponse({ ok: true });
            break;
          case 'SHOW_TOAST':
            showToast(message.message, message.toastType, message.persistent);
            sendResponse({ ok: true });
            break;
          case 'GET_SELECTION': {
            const snapshot = getSelectionSnapshot();
            sendResponse({ ok: true, text: snapshot?.text || '', selectionId: snapshot?.id || '' });
            break;
          }
          case 'INSERT_TRANSLATION':
            insertTranslation(message.translation, message.selectionId);
            sendResponse({ ok: true });
            break;
          case 'TRANSLATE_PAGE_START':
            sendResponse({ ok: true, ...startPageTranslation(message.options) });
            break;
          case 'TRANSLATE_PAGE_RESTORE': {
            const restored = restorePage();
            showToast(restored ? 'Original text restored.' : 'Nothing to restore on this page.');
            sendResponse({ ok: true, restored });
            break;
          }
          default:
            sendResponse({ ok: false, error: 'Unknown message type.' });
        }
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  });
})();
