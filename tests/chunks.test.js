import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const code = fs
    .readFileSync(new URL('../web/src/audio/chunks.js', import.meta.url), 'utf8')
    .replace('export function', 'function'),
  tick = () => new Promise((r) => setImmediate(r));
async function flush(n = 12) {
  for (let i = 0; i < n; i++) await tick();
}
function fixture({ count = 7, frames = 352800, lengths = null, block = null, fail = null } = {}) {
  const buffers = new Map(),
    nodes = [],
    events = [],
    timers = new Set(),
    requests = [],
    gate = {};
  lengths ||= Array(count).fill(frames);
  let sum = 0;
  const manifest = {
    sampleRate: 44100,
    channels: 4,
    chunks: lengths.map((n, i) => {
      const first = sum;
      sum += n;
      return { src: 'c' + i, first, last: sum };
    }),
    frames: lengths.reduce((a, b) => a + b, 0),
  };
  const context = {
    currentTime: 10,
    state: 'running',
    output: 0,
    getOutputTimestamp() {
      return { contextTime: this.output };
    },
    addEventListener() {},
    removeEventListener() {},
    createGain() {
      return {
        gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    },
    createBufferSource() {
      const node = {
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        stop(at) {
          if (at === undefined) this.stopped = true;
          else {
            this.end = at;
            this.duration = at - this.at;
          }
        },
        start(at, offset, duration) {
          Object.assign(this, { at, offset, duration, end: at + duration });
        },
      };
      nodes.push(node);
      return node;
    },
  };
  const window = {
    OfflineAudioContext: class {
      async decodeAudioData(encoded) {
        const i = JSON.parse(new TextDecoder().decode(encoded));
        return (
          buffers.get(i) ||
          (() => {
            const b = { length: lengths[i], sampleRate: 44100, numberOfChannels: 4, index: i };
            buffers.set(i, b);
            return b;
          })()
        );
      }
    },
  };
  const fetch = async (src) => {
    const i = Number(src.slice(1));
    requests.push(i);
    if (block?.(i, requests))
      await new Promise((resolve, reject) => (gate[i] = { resolve, reject }));
    if (fail?.(i, requests)) throw Error('network');
    return new Response(JSON.stringify(i));
  };
  const scope = {
    window,
    fetch,
    DOMException,
    setTimeout,
    clearTimeout,
    setInterval: (fn) => (timers.add(fn), fn),
    clearInterval: (fn) => timers.delete(fn),
  };
  vm.runInNewContext(code + ';this.factory=createChunkedAudio', scope);
  const decoder = {
    full: async () => {
      throw Error('unexpected fallback');
    },
    range: async () => {
      throw Error('unexpected fallback');
    },
  };
  const engine = scope.factory({ decoder, manifests: { full: manifest } });
  window.createChunkedSession = engine.createSession;
  window.chunkAudioDiagnostics = engine.diagnostics;
  const mixer = { getContext: () => context, connectSource() {}, resume: async () => {} };
  const create = (first = 0, last = manifest.frames) =>
    window.createChunkedSession(
      { manifest, first, last },
      { mixer, emit: (t) => events.push(t), repeat: true, muted: false },
    );
  function advance(t) {
    context.currentTime = t;
    for (const n of nodes)
      if (!n.stopped && !n.fired && n.end <= t) {
        n.fired = true;
        n.onended?.();
      }
    for (const fn of [...timers]) fn();
  }
  return {
    factory: scope.factory,
    engine,
    window,
    manifest,
    context,
    nodes,
    events,
    requests,
    gate,
    timers,
    create,
    advance,
  };
}
test('sample scheduling, loops, latency, pending seeks and network recovery', async () => {
  let checks = 0;
  // Cross every file boundary and full loop with one exact sample clock.
  for (const fraction of [0, 0.25, 0.999]) {
    const f = fixture(),
      s = f.create();
    s.seek(fraction * 8);
    await s.play();
    await flush();
    let previous;
    for (let i = 0; i < 500; i++) {
      const t = f.context.currentTime + 0.17;
      f.advance(t);
      await flush(2);
      const snapshot = s.snapshot(),
        debug = s.debug();
      assert(snapshot.time >= 0 && snapshot.time < s.duration);
      assert.equal(
        snapshot.cycle,
        Math.floor(
          (debug.base +
            Math.min(debug.scheduled, Math.max(0, Math.floor((t - debug.anchor) * 44100 + 1e-6)))) /
            f.manifest.frames,
        ),
      );
      for (const n of f.nodes) {
        if (n.checked) continue;
        n.checked = true;
        if (previous)
          assert(Math.abs(previous.end - n.at) < 1e-9, 'no gaps or overlaps at normal chunk joins');
        previous = n;
        assert(n.offset >= 0 && n.duration > 0);
        assert(n.offset + n.duration <= n.buffer.length / 44100 + 1e-9);
      }
      checks++;
    }
    assert(f.nodes.length > 10);
    assert(!f.events.includes('error'));
    assert.equal(f.window.chunkAudioDiagnostics().underruns, 0);
    s.dispose();
    assert.equal(f.timers.size, 0);
  }
  // Arbitrary range boundaries can split a chunk and wrap inside another chunk.
  for (const [first, last] of [
    [12345, 100000],
    [350000, 800000],
    [500, 510],
    [1, 352801],
  ]) {
    const f = fixture(),
      s = f.create(first, last);
    await s.play();
    await flush();
    const records = s.debug().nodes;
    assert(records.length > 0);
    let expected = first;
    for (const r of records) {
      assert.equal(r.first, expected);
      assert(r.last <= last);
      expected = r.last === last ? first : r.last;
    }
    for (const t of [0.01, 0.1, 0.7]) {
      f.advance(f.context.currentTime + t);
      await flush();
      assert(s.snapshot().time >= 0 && s.snapshot().time < s.duration);
    }
    s.dispose();
    checks++;
  }
  // Output latency affects captions, never a separate wall-clock timer.
  {
    const f = fixture(),
      s = f.create();
    await s.play();
    f.context.currentTime = s.debug().anchor + 1;
    f.context.output = f.context.currentTime - 0.08;
    assert(Math.abs(s.currentTime - 0.92) < 1 / 44100);
    s.pause();
    const at = s.currentTime;
    f.advance(f.context.currentTime + 10);
    assert.equal(s.currentTime, at);
    s.dispose();
    checks++;
  }
  // Stop at an unavailable boundary; never advance lyric time through silence.
  {
    const f = fixture({ block: (i) => i === 1 }),
      s = f.create();
    const play = s.play();
    await flush();
    assert(f.gate[1]);
    const d = s.debug();
    f.advance(d.anchor + 8.3);
    await flush();
    const frozen = s.currentTime;
    assert.equal(frozen, 8);
    assert(!s.snapshot().audible);
    f.advance(f.context.currentTime + 20);
    assert.equal(s.currentTime, frozen);
    f.gate[1].resolve();
    await play;
    await flush();
    assert.equal(s.currentTime, 8);
    const start = s.debug().anchor;
    f.advance(start + 0.5);
    assert(Math.abs(s.currentTime - 8.5) < 1 / 44100);
    assert(f.events.includes('waiting'));
    s.dispose();
    checks++;
  }
  // Rapid seek while decode/download is pending cannot start an obsolete source.
  {
    const f = fixture({ block: (i) => i === 1 }),
      s = f.create();
    const play = s.play();
    await flush();
    assert(f.gate[1]);
    s.seek(24.5);
    const keep = f.nodes.length;
    const second = s.play();
    await flush();
    f.gate[1].resolve();
    await play.catch(() => {});
    await second;
    await flush();
    for (const n of f.nodes.slice(keep))
      assert(n.buffer.index >= 3, 'old queued chunk must not be scheduled after seek');
    s.pause();
    const active = f.nodes.filter((n) => !n.stopped);
    assert.equal(active.length, 0);
    s.dispose();
    checks++;
  }
  // Decode failure retries once, then becomes an explicit error.
  {
    const f = fixture({ fail: (i) => i === 1 }),
      s = f.create();
    await s.play();
    await flush();
    assert(f.events.includes('error'));
    assert(s.paused);
    assert.equal(f.requests.filter((i) => i === 1).length, 2);
    const position = s.currentTime;
    f.advance(f.context.currentTime + 10);
    assert.equal(s.currentTime, position);
    s.dispose();
    checks++;
  }
  // Disposed source ignores late data and cannot resume itself.
  {
    const f = fixture({ block: (i) => i === 0 }),
      s = f.create();
    const p = s.play();
    await flush();
    s.dispose();
    f.gate[0].resolve();
    await assert.rejects(p, (e) => e.name === 'AbortError');
    assert.equal(f.nodes.length, 0);
    assert.equal(f.timers.size, 0);
    checks++;
  }
  // Unsupported first chunk uses the existing decoder with the same bounds;
  // cancellation never falls back to an obsolete song or range.
  {
    const f = fixture({ fail: (i) => i === 0 }),
      sentinel = { fallback: true };
    let calls = 0;
    const engine = f.factory({
      manifests: { full: f.manifest },
      decoder: {
        full: async (request) => {
          calls++;
          assert.equal(request.src, 'full');
          return sentinel;
        },
        range: async (request) => {
          calls++;
          assert.equal(request.start, 2);
          assert.equal(request.end, 5);
          return sentinel;
        },
      },
    });
    assert.equal(await engine.full({ src: 'full' }), sentinel);
    assert.equal(engine.diagnostics().fallbacks, 1);
    assert.equal(await engine.range({ src: 'full', start: 2, end: 5 }), sentinel);
    assert.equal(calls, 2);
    assert.equal(f.requests.length, 1);
    checks++;
  }
  {
    const f = fixture({ fail: (i) => i === 0 });
    let calls = 0;
    const engine = f.factory({
      manifests: { full: f.manifest },
      decoder: {
        full: () => {
          calls++;
        },
      },
    });
    await assert.rejects(
      engine.full({ src: 'full', isCurrent: () => false }),
      (e) => e.name === 'AbortError',
    );
    assert.equal(calls, 0);
    checks++;
  }
  assert.equal(checks, 1511);
});
