export function createDecoder(cache) {
  const decoded = new Map(),
    LIMIT = 192 * 1024 * 1024;
  const now = () => window.performance?.now?.() || Date.now(),
    measurements = [];
  const diagnostics = () => measurements.map((item) => ({ ...item }));
  async function decode(src, onProgress) {
    let entry = decoded.get(src);
    if (!entry) {
      entry = { bytes: 0, listeners: new Set(), last: null, promise: null };
      const update = (state) => {
        entry.last = state;
        for (const listener of entry.listeners) {
          try {
            listener(state);
          } catch {}
        }
      };

      entry.promise = (async () => {
        const started = now();
        let source = 'network';
        const response = cache
          ? await cache.get(src, {
              onProgress: (state) => {
                if (state.phase === 'cached') source = 'disk-cache';
                update(state);
              },
            })
          : await fetch(src);
        if (!response.ok) throw new Error('Audio fetch failed');
        const bytes = await response.arrayBuffer(),
          readFinished = now(),
          Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Context) throw new Error('Audio decoding unavailable');
        // Decoding must never open/close a hardware audio session while the user's
        // first tap is enabling playback. This offline context has no output device.
        // Preserve the source assets' 44.1 kHz bandwidth and all four stem channels.
        update({ phase: 'decode', percent: null });
        const context = new Context(4, 1, 44100);
        let timer;
        let audio;
        try {
          audio = await Promise.race([
            context.decodeAudioData(bytes),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Audio decoding timed out')), 30000);
            }),
          ]);
        } catch (error) {
          entry.invalidBytes = ['EncodingError', 'DataError'].includes(error?.name);
          throw error;
        } finally {
          clearTimeout(timer);
        }
        measurements.push({
          src,
          source,
          readMs: Math.round(readFinished - started),
          decodeMs: Math.round(now() - readFinished),
          duration: audio.duration,
          channels: audio.numberOfChannels,
        });
        if (measurements.length > 30) measurements.shift();
        entry.bytes = audio.length * audio.numberOfChannels * 4;
        let total = [...decoded.values()].reduce((sum, item) => sum + item.bytes, 0);
        for (const [key, item] of decoded) {
          if (total <= LIMIT && decoded.size <= 8) break;
          if (key === src || !item.bytes) continue;
          decoded.delete(key);
          total -= item.bytes;
        }
        update({ phase: 'ready', percent: 100 });
        return audio;
      })();
      decoded.set(src, entry);
    }
    decoded.delete(src);
    decoded.set(src, entry);
    if (onProgress) {
      entry.listeners.add(onProgress);
      if (entry.last) onProgress(entry.last);
    }
    try {
      return await entry.promise;
    } catch (error) {
      if (decoded.get(src) === entry) decoded.delete(src);
      if (entry.invalidBytes) await cache?.invalidate?.(src);
      throw error;
    } finally {
      if (onProgress) entry.listeners.delete(onProgress);
    }
  }
  const full = async ({ src, isCurrent = () => true, onProgress }) => {
    const audio = await decode(src, onProgress);
    if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    return {
      audio,
      first: 0,
      last: audio.length,
      start: 0,
      end: audio.duration,
      duration: audio.duration,
    };
  };
  const range = async ({ src, start, end, isCurrent = () => true, onProgress }) => {
    const audio = await decode(src, onProgress);
    if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    const first = Math.max(0, Math.floor(start * audio.sampleRate)),
      last = Math.min(audio.length, Math.ceil(end * audio.sampleRate));
    if (last <= first) throw new Error('Empty segment');
    return {
      audio,
      first,
      last,
      start: first / audio.sampleRate,
      end: last / audio.sampleRate,
      duration: (last - first) / audio.sampleRate,
    };
  };

  return { full, range, diagnostics };
}
