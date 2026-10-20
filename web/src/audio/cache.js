export function createAudioCache() {
  const NAME = 'lyrics-audio-v1',
    LIMIT = 512 * 1024 * 1024,
    inflight = new Map(),
    invalidated = new Set();
  let storePromise, sizesPromise, persistPromise;
  const stats = { cacheHits: 0, downloads: 0, writes: 0, writeFailures: 0, storageAvailable: null };
  const writing = new Map();
  async function persist() {
    if (!persistPromise)
      persistPromise = (async () => {
        try {
          const storage = window.navigator?.storage;
          if (!storage?.persist) return false;
          return (await storage.persisted()) || (await storage.persist());
        } catch {
          return false;
        }
      })();
    return persistPromise;
  }
  const key = (src) => new URL(src, window.location.href).href;
  async function store() {
    if (!storePromise)
      storePromise = (async () => {
        try {
          const cache = (await window.caches?.open(NAME)) || null;
          stats.storageAvailable = !!cache;
          return cache;
        } catch {
          stats.storageAvailable = false;
          return null;
        }
      })();
    return storePromise;
  }
  async function trim(cache, url, size) {
    try {
      if (!sizesPromise)
        sizesPromise = (async () => {
          const keys = await cache.keys();
          return new Map(
            await Promise.all(
              keys.map(async (request) => {
                const response = await cache.match(request);
                return [
                  request.url,
                  Number(
                    response?.headers.get('X-Practice-Audio-Bytes') ||
                      response?.headers.get('Content-Length') ||
                      0,
                  ),
                ];
              }),
            ),
          );
        })();
      const sizes = await sizesPromise;
      sizes.delete(url);
      sizes.set(url, size);
      let total = [...sizes.values()].reduce((a, b) => a + b, 0);
      for (const [request, bytes] of sizes) {
        if (total <= LIMIT) break;
        sizes.delete(request);
        total -= bytes;
        await cache.delete(request);
      }
    } catch {}
  }
  async function get(src, { onProgress, background = false } = {}) {
    const url = key(src);
    let entry = inflight.get(url);
    if (entry?.controller.signal.aborted) {
      try {
        await entry.promise;
      } catch {}
      return get(src, { onProgress, background });
    }
    if (entry) {
      if (!background) entry.foreground = true;
      if (onProgress) {
        entry.listeners.add(onProgress);
        if (entry.last) onProgress(entry.last);
      }
      return (await entry.promise).clone();
    }
    entry = {
      listeners: new Set(onProgress ? [onProgress] : []),
      foreground: !background,
      controller: new AbortController(),
      last: null,
    };
    const update = (state) => {
      entry.last = state;
      for (const listener of entry.listeners) {
        try {
          listener(state);
        } catch {}
      }
    };
    entry.promise = (async () => {
      const cache = await store();
      if (cache) {
        try {
          const hit = await cache.match(url);
          if (hit) {
            stats.cacheHits++;
            if (entry.foreground && sizesPromise)
              void sizesPromise
                .then((sizes) => {
                  const bytes = sizes.get(url);
                  if (bytes !== undefined) {
                    sizes.delete(url);
                    sizes.set(url, bytes);
                  }
                })
                .catch(() => {});
            update({ phase: 'cached', percent: 100 });
            return hit;
          }
        } catch {}
      }
      if (writing.has(url)) {
        await writing.get(url);
        try {
          const hit = await cache?.match(url);
          if (hit) {
            stats.cacheHits++;
            update({ phase: 'cached', percent: 100 });
            return hit;
          }
        } catch {}
      }
      let idle = null,
        totalTimer = null;
      const reset = () => {
        if (idle !== null) clearTimeout(idle);
        idle = setTimeout(() => entry.controller.abort(), 20000);
      };
      try {
        stats.downloads++;
        update({ phase: 'download', percent: null });
        reset();
        totalTimer = setTimeout(() => entry.controller.abort(), 120000);
        const response = await fetch(url, {
          signal: entry.controller.signal,
          cache: invalidated.has(url) ? 'reload' : 'default',
          priority: background ? 'low' : 'high',
        });
        if (!response.ok) throw new Error('Audio HTTP ' + response.status);
        const total = Number(response.headers.get('Content-Length')) || 0;
        let loaded = 0,
          bytes;
        if (response.body?.getReader) {
          const reader = response.body.getReader(),
            parts = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            loaded += value.byteLength;
            reset();
            update({
              phase: 'download',
              percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : null,
            });
          }
          bytes = new Blob(parts, { type: response.headers.get('Content-Type') || 'audio/mp4' });
        } else {
          bytes = await response.blob();
          loaded = bytes.size;
        }
        const headers = new Headers(response.headers);
        headers.set('Content-Length', String(loaded));
        headers.set('X-Practice-Audio-Bytes', String(loaded));
        const result = new Response(bytes, { status: 200, headers });
        if (cache) {
          // Playback may decode as soon as bytes arrive; disk persistence and index
          // maintenance must not hold the first audible sample behind hundreds of IOs.
          const save = (async () => {
            try {
              await cache.put(url, result.clone());
              stats.writes++;
              await trim(cache, url, loaded);
            } catch {
              try {
                const keys = await cache.keys();
                for (const request of keys.slice(0, Math.ceil(keys.length / 3)))
                  await cache.delete(request);
                sizesPromise = null;
                await cache.put(url, result.clone());
                stats.writes++;
              } catch {
                stats.writeFailures++;
              }
            }
          })();
          writing.set(url, save);
          void save.finally(() => {
            if (writing.get(url) === save) writing.delete(url);
          });
          if (!entry.foreground) await save;
        }
        invalidated.delete(url);
        update({ phase: 'ready', percent: 100 });
        return result;
      } finally {
        if (idle !== null) clearTimeout(idle);
        if (totalTimer !== null) clearTimeout(totalTimer);
      }
    })();
    inflight.set(url, entry);
    try {
      return (await entry.promise).clone();
    } finally {
      if (inflight.get(url) === entry) inflight.delete(url);
    }
  }
  return {
    get,
    persist,
    getDiagnostics: async () => {
      let storedFiles = 0,
        bytes = 0;
      try {
        const cache = await store();
        for (const request of (await cache?.keys()) || []) {
          storedFiles++;
          const response = await cache.match(request);
          bytes += Number(
            response?.headers.get('X-Practice-Audio-Bytes') ||
              response?.headers.get('Content-Length') ||
              0,
          );
        }
      } catch {}
      return {
        ...stats,
        storedFiles,
        bytes,
        limit: LIMIT,
        persistent: (await window.navigator?.storage?.persisted?.().catch(() => false)) || false,
      };
    },
    async invalidate(src) {
      const url = key(src);
      invalidated.add(url);
      try {
        const cache = await store();
        await cache?.delete(url);
        if (sizesPromise) (await sizesPromise).delete(url);
      } catch {}
    },
    async playable(src, options) {
      const response = await get(src, options);
      const url = URL.createObjectURL(await response.blob());
      return { url, release: () => URL.revokeObjectURL(url) };
    },
  };
}
