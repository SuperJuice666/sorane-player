export function createChunkedAudio({ cache: cacheStore, decoder, manifests }) {
  const SR = 44100,
    LIMIT = 32 * 1024 * 1024,
    cache = new Map(),
    disabledManifests = new WeakSet();
  let bytes = 0,
    decodeContext;
  const stats = {
    requests: 0,
    decodes: 0,
    bufferedBytes: 0,
    peakBytes: 0,
    underruns: 0,
    fallbacks: 0,
  };
  const cancelled = () => new DOMException('Cancelled', 'AbortError');
  function trim() {
    for (const [key, item] of cache) {
      if (bytes <= LIMIT) break;
      if (item.pins || !item.buffer) continue;
      cache.delete(key);
      bytes -= item.bytes;
    }
    stats.bufferedBytes = bytes;
    stats.peakBytes = Math.max(stats.peakBytes, bytes);
  }
  async function load(chunk, onProgress) {
    let item = cache.get(chunk.src);
    if (item) {
      cache.delete(chunk.src);
      cache.set(chunk.src, item);
      return item.promise;
    }
    item = { pins: 0, bytes: 0 };
    cache.set(chunk.src, item);
    item.promise = (async () => {
      const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Context) throw Error('Audio decoding unavailable');
      decodeContext ||= new Context(4, 1, SR);
      const planes = await Promise.all(
        (chunk.parts || [chunk.src]).map(async (src) => {
          stats.requests++;
          const response = cacheStore
            ? await cacheStore.get(src, { onProgress })
            : await fetch(src);
          if (!response.ok) throw Error('Chunk HTTP ' + response.status);
          const encoded = await response.arrayBuffer();
          onProgress?.({ phase: 'decode', percent: null });
          stats.decodes++;
          let timer;
          return Promise.race([
            decodeContext.decodeAudioData(encoded),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('Chunk decode timed out')), 15000);
            }),
          ]).finally(() => clearTimeout(timer));
        }),
      );
      const frames = chunk.decodedFrames || chunk.last - chunk.first;
      // Some AAC decoders expose the encoder's 1024 priming samples while
      // others honor the MP4 edit list. Normalize before using timeline offsets.
      for (let i = 0; i < planes.length; i++)
        if (chunk.parts && planes[i].length === frames + 1024) {
          const raw = planes[i],
            clean = decodeContext.createBuffer(raw.numberOfChannels, frames, SR);
          for (let c = 0; c < raw.numberOfChannels; c++)
            clean.copyToChannel(raw.getChannelData(c).subarray(1024, 1024 + frames), c);
          planes[i] = clean;
        }
      if (
        planes.some((p) => p.sampleRate !== SR || p.length !== frames) ||
        planes.reduce((sum, p) => sum + p.numberOfChannels, 0) !== 4
      )
        throw Error(
          'Chunk sample layout mismatch: expected ' +
            frames +
            ' at ' +
            SR +
            ' Hz; got ' +
            planes.map((p) => p.length + '/' + p.numberOfChannels + '/' + p.sampleRate).join(', '),
        );
      let buffer = planes[0];
      if (planes.length > 1) {
        buffer = decodeContext.createBuffer(4, frames, SR);
        let c = 0;
        for (const plane of planes)
          for (let channel = 0; channel < plane.numberOfChannels; channel++)
            buffer.copyToChannel(plane.getChannelData(channel), c++);
      }
      item.buffer = buffer;
      item.bytes = buffer.length * 16;
      bytes += item.bytes;
      trim();
      return buffer;
    })().catch((error) => {
      if (cache.get(chunk.src) === item) cache.delete(chunk.src);
      throw error;
    });
    return item.promise;
  }
  function pin(chunk) {
    const item = cache.get(chunk.src);
    if (item) item.pins++;
    return () => {
      if (item) item.pins = Math.max(0, item.pins - 1);
      trim();
    };
  }
  function find(manifest, frame) {
    let low = 0,
      high = manifest.chunks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (manifest.chunks[mid].last <= frame) low = mid + 1;
      else high = mid;
    }
    return manifest.chunks[Math.min(low, manifest.chunks.length - 1)];
  }
  const diagnostics = () => ({ ...stats, cachedChunks: cache.size });
  const createSession = (data, { mixer, emit, repeat = true, muted = false }) => {
    const context = mixer.getContext(),
      gain = context.createGain(),
      first = data.first,
      last = data.last,
      length = last - first,
      duration = length / SR,
      active = new Set();
    mixer.connectSource(gain);
    gain.gain.value = muted ? 0 : 1;
    let base = 0,
      anchor = 0,
      scheduled = 0,
      running = false,
      wanted = false,
      disposed = false,
      command = 0,
      pumping = false,
      again = false,
      finished = false,
      tail = null,
      timer = null,
      previous = null,
      notifyStart = null;
    const clock = () => {
      const t = context.getOutputTimestamp?.().contextTime;
      return Number.isFinite(t) && t > 0 && t <= context.currentTime ? t : context.currentTime;
    };
    const travelled = () =>
      running ? Math.min(scheduled, Math.max(0, Math.floor((clock() - anchor) * SR + 1e-6))) : 0;
    const total = () =>
      tail && (!running || clock() < anchor)
        ? tail.base +
          Math.min(tail.scheduled, Math.max(0, Math.floor((clock() - tail.anchor) * SR + 1e-6)))
        : base + travelled();
    const phase = (value) => {
      const cycle = repeat ? Math.floor(value / length) : 0;
      return { time: (repeat ? value % length : Math.min(length, value)) / SR, cycle };
    };
    function stopNodes() {
      for (const entry of active) {
        entry.node.onended = null;
        try {
          entry.node.stop();
        } catch {}
        entry.node.disconnect();
        entry.edge?.disconnect();
        entry.unpin();
      }
      active.clear();
      previous = null;
    }
    function disarm() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }
    function starve() {
      if (!running) return;
      tail = { base, anchor, scheduled };
      base += scheduled;
      scheduled = 0;
      running = false;
      stopNodes();
      stats.underruns++;
      emit('waiting');
    }
    function ensureTimer() {
      if (timer === null) timer = setInterval(maintain, 50);
    }
    function maintain() {
      if (disposed || !wanted) return;
      if (running && context.currentTime >= anchor + scheduled / SR && scheduled > 0) {
        if (!repeat && base + scheduled >= length) {
          base = length;
          running = false;
          wanted = false;
          finished = true;
          stopNodes();
          disarm();
          emit('timeupdate');
          emit('ended');
          return;
        }
        starve();
      }
      void pump();
    }
    async function pump() {
      if (pumping) {
        again = true;
        return;
      }
      pumping = true;
      const request = command;
      try {
        do {
          again = false;
          if (disposed || !wanted || request !== command) return;
          const horizon = Math.min(16, Math.max(2, duration * 3));
          while (
            !disposed &&
            wanted &&
            request === command &&
            active.size < 64 &&
            (!running || (scheduled - travelled()) / SR < horizon)
          ) {
            const logical = base + scheduled;
            if (!repeat && logical >= length) break;
            const local = repeat ? logical % length : logical,
              absolute = first + local,
              chunk = find(data.manifest, absolute);
            let buffer;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                buffer = await load(chunk, data.onProgress);
                break;
              } catch (error) {
                if (disposed || !wanted || request !== command) return;
                if (attempt) throw error;
              }
            }
            if (disposed || !wanted || request !== command) return;
            if (running && context.currentTime > anchor + scheduled / SR - 0.002) {
              starve();
              continue;
            }
            if (!running) {
              anchor = context.currentTime + 0.03;
              scheduled = 0;
              running = true;
              emit('playing');
            }
            const count = Math.min(chunk.last - absolute, last - absolute),
              node = context.createBufferSource(),
              at = anchor + scheduled / SR;
            const edge = context.createGain(),
              seconds = count / SR,
              fade = Math.min(0.002, seconds / 2);
            edge.gain.setValueAtTime(1, at);
            if (absolute === first) {
              edge.gain.setValueAtTime(0, at);
              edge.gain.linearRampToValueAtTime(1, at + fade);
            }
            if (absolute + count === last) {
              edge.gain.setValueAtTime(1, at + seconds - fade);
              edge.gain.linearRampToValueAtTime(0, at + seconds);
            }
            const overlap =
              previous &&
              active.has(previous) &&
              previous.last === absolute &&
              previous.last !== last
                ? Math.min(chunk.crossfadeFrames || 0, previous.postRoll || 0, count)
                : 0;
            if (overlap) {
              // Both voices cover the SAME absolute samples; complementary linear
              // gains sum to one. This smooths decoder reset noise without repeating
              // words, moving the timeline, or boosting a correlated musical signal.
              const end = at + overlap / SR,
                bridge = context.createBufferSource(),
                bridgeGain = context.createGain();
              bridge.buffer = previous.node.buffer;
              bridge.playbackRate.value = 1;
              bridge.connect(bridgeGain);
              bridgeGain.connect(gain);
              bridgeGain.gain.setValueAtTime(1, at);
              bridgeGain.gain.linearRampToValueAtTime(0, end);
              const tailEntry = {
                node: bridge,
                edge: bridgeGain,
                unpin: pin(previous.chunk),
                at,
                end,
                first: absolute,
                last: absolute + overlap,
                bridge: true,
              };
              active.add(tailEntry);
              bridge.onended = () => {
                if (!active.delete(tailEntry)) return;
                bridge.disconnect();
                bridgeGain.disconnect();
                tailEntry.unpin();
                maintain();
              };
              bridge.start(
                at,
                ((previous.chunk.trimStart || 0) + absolute - previous.chunk.first) / SR,
                overlap / SR,
              );
              edge.gain.setValueAtTime(0, at);
              edge.gain.linearRampToValueAtTime(1, end);
            }
            node.buffer = buffer;
            node.playbackRate.value = 1;
            node.connect(edge);
            edge.connect(gain);
            const entry = {
              node,
              edge,
              chunk,
              unpin: pin(chunk),
              at,
              end: at + count / SR,
              first: absolute,
              last: absolute + count,
              postRoll: absolute + count === chunk.last ? chunk.postRoll || 0 : 0,
            };
            active.add(entry);
            node.onended = () => {
              if (!active.delete(entry)) return;
              node.disconnect();
              edge.disconnect();
              entry.unpin();
              maintain();
            };
            node.start(at, (absolute - chunk.first + (chunk.trimStart || 0)) / SR, count / SR);
            previous = entry;
            scheduled += count;
            notifyStart?.();
            notifyStart = null;
          }
        } while (again);
      } catch (error) {
        if (!disposed && wanted && request === command) {
          const held = total();
          wanted = false;
          running = false;
          base = held;
          scheduled = 0;
          tail = null;
          stopNodes();
          disarm();
          data.lastError = String(error);
          disabledManifests.add(data.manifest);
          stats.lastError = String(error);
          emit('error');
        }
      } finally {
        pumping = false;
        if (again && !disposed && wanted) void pump();
      }
    }
    const onState = () => {
      if (wanted) {
        emit(context.state === 'running' ? 'playing' : 'waiting');
        maintain();
      }
    };
    context.addEventListener('statechange', onState);
    return {
      snapshot() {
        const p = phase(total());
        return {
          ...p,
          audible:
            wanted &&
            running &&
            clock() >= anchor &&
            context.state === 'running' &&
            travelled() < scheduled,
          source: 'audio-context-chunks',
        };
      },
      get currentTime() {
        return phase(total()).time;
      },
      get cycle() {
        return phase(total()).cycle;
      },
      get duration() {
        return duration;
      },
      get paused() {
        return !wanted;
      },
      get ended() {
        return finished;
      },
      get repeat() {
        return repeat;
      },
      get audible() {
        return this.snapshot().audible;
      },
      async play() {
        if (wanted) return;
        const request = ++command;
        wanted = true;
        finished = false;
        tail = null;
        if (!repeat && base >= length) base = 0;
        try {
          await mixer.resume();
          if (disposed || request !== command) throw cancelled();
          emit('waiting');
          await load(find(data.manifest, first + (base % length)), data.onProgress);
          if (disposed || request !== command) throw cancelled();
          ensureTimer();
          const started = new Promise((resolve) => {
            notifyStart = resolve;
          });
          await Promise.race([pump(), started]);
          if (disposed || request !== command) throw cancelled();
          if (data.lastError) throw Error(data.lastError);
        } catch (error) {
          if (request === command) {
            wanted = false;
            disarm();
          }
          throw error;
        }
      },
      pause() {
        notifyStart?.();
        notifyStart = null;
        base = total();
        wanted = false;
        running = false;
        scheduled = 0;
        tail = null;
        command++;
        stopNodes();
        disarm();
      },
      seek(seconds) {
        this.pause();
        base = Math.max(0, Math.min(length - 1, Math.round((Number(seconds) || 0) * SR)));
        finished = false;
        data.lastError = null;
      },
      mute(value) {
        gain.gain.setValueAtTime(value ? 0 : 1, context.currentTime);
      },
      dispose() {
        this.pause();
        disposed = true;
        gain.disconnect();
        context.removeEventListener('statechange', onState);
      },
      debug() {
        return {
          base,
          anchor,
          scheduled,
          running,
          wanted,
          command,
          nodes: [...active].map((x) => ({ at: x.at, end: x.end, first: x.first, last: x.last })),
        };
      },
    };
  };

  const originalFull = decoder.full,
    originalLoop = decoder.range;
  const lookup = (src) => {
    const manifest = manifests?.[src.split('?')[0]];
    return manifest && !disabledManifests.has(manifest) ? manifest : null;
  };
  async function prepare(request, range) {
    const manifest = lookup(request.src);
    if (!manifest) return (range ? originalLoop : originalFull)(request);
    const first = range ? Math.max(0, Math.floor(request.start * SR)) : 0,
      last = range ? Math.min(manifest.frames, Math.ceil(request.end * SR)) : manifest.frames;
    if (last <= first) throw Error('Empty segment');
    await load(find(manifest, first), request.onProgress);
    if (request.isCurrent && !request.isCurrent()) throw cancelled();
    if (range && last - first <= 20 * SR) {
      // Short practice ranges loop as ONE native buffer. They never depend on a
      // page timer repeatedly scheduling tiny fragments at the loop boundary.
      const output = decodeContext.createBuffer(4, last - first, SR),
        fade = Math.min(SR * 0.002, (last - first) / 2);
      let previousChunk = null,
        previousBuffer = null;
      for (const chunk of manifest.chunks) {
        if (chunk.last <= first || chunk.first >= last) continue;
        const buffer = await load(chunk, request.onProgress);
        if (request.isCurrent && !request.isCurrent()) throw cancelled();
        const begin = Math.max(first, chunk.first),
          end = Math.min(last, chunk.last);
        for (let c = 0; c < 4; c++) {
          const plane = output.getChannelData(c),
            source = buffer.getChannelData(c),
            trim = chunk.trimStart || 0;
          plane.set(
            source.subarray(begin - chunk.first + trim, end - chunk.first + trim),
            begin - first,
          );
          const overlap =
            previousChunk && begin === chunk.first
              ? Math.min(chunk.crossfadeFrames || 0, previousChunk.postRoll || 0, end - begin)
              : 0;
          if (overlap) {
            const before = previousBuffer.getChannelData(c),
              offset = (previousChunk.trimStart || 0) + previousChunk.last - previousChunk.first;
            for (let i = 0; i < overlap; i++)
              plane[begin - first + i] =
                before[offset + i] * (1 - i / overlap) + source[trim + i] * (i / overlap);
          }
        }
        previousChunk = chunk;
        previousBuffer = buffer;
      }
      for (let c = 0; c < 4; c++) {
        const plane = output.getChannelData(c);
        for (let i = 0; i < Math.ceil(fade); i++) {
          plane[i] *= i / fade;
          plane[plane.length - 1 - i] *= i / fade;
        }
      }
      return {
        audio: output,
        first: 0,
        last: output.length,
        start: first / SR,
        end: last / SR,
        duration: output.duration,
      };
    }
    return {
      chunked: true,
      manifest,
      first,
      last,
      start: first / SR,
      end: last / SR,
      duration: (last - first) / SR,
      onProgress: request.onProgress,
    };
  }
  async function guarded(request, range) {
    try {
      return await prepare(request, range);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (request.isCurrent && !request.isCurrent()) throw cancelled();
      const manifest = lookup(request.src);
      if (manifest) disabledManifests.add(manifest);
      stats.fallbacks++;
      stats.lastError = String(error);
      return (range ? originalLoop : originalFull)(request);
    }
  }

  return {
    full: (request) => guarded(request, false),
    range: (request) => guarded(request, true),
    createSession,
    diagnostics,
  };
}
