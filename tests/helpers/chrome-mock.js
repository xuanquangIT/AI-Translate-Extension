/**
 * Minimal in-memory `chrome` API for Node tests. Install before importing any
 * module that touches `chrome.*` at load time (for example background/*).
 *
 *   const chrome = installChromeMock({ local: { toLang: 'fr' } });
 *   const { loadSettings } = await import('../../src/storage/index.js');
 */

function createArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result = {};
      for (const key of list) if (key in data) result[key] = structuredClone(data[key]);
      return result;
    },
    async set(patch) {
      Object.assign(data, structuredClone(patch));
    },
    async remove(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
    },
    async clear() {
      for (const key of Object.keys(data)) delete data[key];
    },
    async setAccessLevel() {}
  };
}

function createEvent() {
  const listeners = [];
  return { listeners, addListener: (fn) => listeners.push(fn), removeListener() {} };
}

export function installChromeMock({ local = {}, session = {} } = {}) {
  const chrome = {
    storage: { local: createArea(local), session: createArea(session) },
    runtime: {
      onInstalled: createEvent(),
      onStartup: createEvent(),
      onMessage: createEvent(),
      sendMessage: async () => ({ ok: true }),
      openOptionsPage() {}
    },
    contextMenus: { onClicked: createEvent(), removeAll: (callback) => callback?.(), create() {} },
    tabs: { query: async () => [], sendMessage: async () => ({ ok: true }) },
    scripting: { executeScript: async () => [] }
  };
  globalThis.chrome = chrome;
  return chrome;
}

/** Resets storage contents in place so already-imported modules see a clean slate. */
export function resetChromeStorage(chrome, { local = {}, session = {} } = {}) {
  for (const [area, initial] of [
    [chrome.storage.local, local],
    [chrome.storage.session, session]
  ]) {
    for (const key of Object.keys(area.data)) delete area.data[key];
    Object.assign(area.data, structuredClone(initial));
  }
}
