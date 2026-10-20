export function createPlaybackTransport({ media, mixer, createChunkedSession }) {
  let loop = null,
    id = '',
    generation = 0,
    seekCommand = 0,
    seeking = false,
    muted = media.muted;
  const listeners = new Map(),
    emit = (type) => {
      for (const fn of listeners.get(type) || []) fn({ type, target: transport });
    };
  for (const type of [
    'loadedmetadata',
    'play',
    'playing',
    'pause',
    'waiting',
    'timeupdate',
    'seeking',
    'seeked',
    'ended',
    'error',
  ])
    media.addEventListener(type, () => {
      if (!loop) emit(type);
    });
  const dispose = () => {
    generation++;
    seekCommand++;
    seeking = false;
    if (loop) {
      loop.dispose();
      loop = null;
    }
    id = '';
  };
  function makeLoop(data, repeat = true) {
    const context = mixer.getContext(),
      samples = data.last - data.first,
      copy = repeat && !(data.first === 0 && data.last === data.audio.length),
      buffer = copy
        ? context.createBuffer(data.audio.numberOfChannels, samples, data.audio.sampleRate)
        : data.audio;
    const fade = Math.max(1, Math.round(buffer.sampleRate * 0.002));
    for (let c = 0; copy && c < buffer.numberOfChannels; c++) {
      const from = data.audio.getChannelData(c),
        to = buffer.getChannelData(c);
      for (let i = 0; i < samples; i++)
        to[i] = from[data.first + i] * Math.min(1, i / fade, (samples - 1 - i) / fade);
    }
    const gain = context.createGain();
    mixer.connectSource(gain);
    gain.gain.value = muted ? 0 : 1;
    let source = null,
      offset = 0,
      anchor = 0,
      playing = false,
      command = 0,
      finished = false,
      endTimer = null;
    const duration = buffer.duration;
    const phase = (t) => {
      if (!repeat) return { time: Math.min(duration, Math.max(0, t)), cycle: 0 };
      const cycle = Math.floor((t + 1e-9) / duration);
      return { time: Math.max(0, t - cycle * duration), cycle };
    };
    const clock = () => {
      // This is an audio-context sample position, not a page/performance timer.
      const stamp = context.getOutputTimestamp?.(),
        t = stamp?.contextTime;
      return Number.isFinite(t) && t > 0 && context.currentTime - t >= 0 ? t : context.currentTime;
    };
    const position = () => (playing ? phase(offset + Math.max(0, clock() - anchor)).time : offset);
    const stop = () => {
      if (endTimer !== null) {
        clearTimeout(endTimer);
        endTimer = null;
      }
      if (source) {
        const active = source;
        source = null;
        active.onended = null;
        try {
          active.stop();
        } catch {}
        active.disconnect();
      }
    };
    const finish = () => {
      if (!playing || repeat) return;
      if (position() < duration) {
        endTimer = setTimeout(finish, 16);
        return;
      }
      offset = duration;
      playing = false;
      finished = true;
      stop();
      emit('timeupdate');
      emit('ended');
    };
    const onState = () => {
      if (playing) emit(context.state === 'running' ? 'playing' : 'waiting');
    };
    context.addEventListener('statechange', onState);
    return {
      snapshot() {
        const t = clock(),
          p = playing ? phase(offset + Math.max(0, t - anchor)) : { time: offset, cycle: 0 };
        return {
          ...p,
          audible: playing && context.state === 'running' && t >= anchor,
          source: 'audio-context-pcm',
        };
      },
      get ended() {
        return finished;
      },
      get repeat() {
        return repeat;
      },
      get currentTime() {
        return position();
      },
      get paused() {
        return !playing;
      },
      get duration() {
        return duration;
      },
      get audible() {
        return playing && context.state === 'running' && clock() >= anchor;
      },
      get cycle() {
        return playing ? phase(offset + Math.max(0, clock() - anchor)).cycle : 0;
      },
      async play() {
        if (playing) return;
        if (finished) {
          offset = 0;
          finished = false;
        }
        const request = ++command;
        await mixer.resume();
        if (request !== command) throw new DOMException('Cancelled', 'AbortError');
        source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = repeat;
        const active = source;
        source.onended = repeat
          ? null
          : () => {
              if (source === active) finish();
            };
        source.loopStart = 0;
        source.loopEnd = duration;
        source.playbackRate.value = 1;
        source.connect(gain);
        anchor = context.currentTime + 0.005;
        try {
          source.start(anchor, offset);
          playing = true;
        } catch (error) {
          stop();
          throw error;
        }
      },
      pause() {
        command++;
        if (playing) offset = position();
        playing = false;
        stop();
      },
      seek(t) {
        finished = false;
        command++;
        stop();
        playing = false;
        offset = Math.max(0, Math.min(duration - 1 / buffer.sampleRate, Number(t) || 0));
      },
      mute(value) {
        gain.gain.setValueAtTime(value ? 0 : 1, context.currentTime);
      },
      dispose() {
        command++;
        playing = false;
        stop();
        gain.disconnect();
        context.removeEventListener('statechange', onState);
      },
    };
  }
  const controls = {
    snapshot() {
      return loop
        ? loop.snapshot()
        : { time: media.currentTime, cycle: 0, audible: !media.paused, source: 'media-element' };
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    attachPCM(data, repeat = false) {
      return controls.attachLoop(data, repeat);
    },
    attachLoop(data, repeat = true) {
      dispose();
      media.pause();
      media.removeAttribute('src');
      media.load();
      loop = data.chunked
        ? createChunkedSession(data, { mixer, emit, repeat, muted })
        : makeLoop(data, repeat);
      id = 'pcm-loop:' + generation;
      const request = generation;
      Promise.resolve().then(() => {
        if (loop && generation === request) emit('loadedmetadata');
      });
    },
    async play() {
      if (!loop) return media.play();
      const active = loop,
        request = generation;
      await active.play();
      if (loop !== active || generation !== request)
        throw new DOMException('Cancelled', 'AbortError');
      emit('play');
      emit('playing');
    },
    pause() {
      if (!loop) {
        media.pause();
        return;
      }
      const wasPlaying = !loop.paused;
      loop.pause();
      if (wasPlaying) emit('pause');
    },
    load() {
      if (!loop) media.load();
    },
    getAttribute(name) {
      return loop && name === 'src' ? id : media.getAttribute(name);
    },
    removeAttribute(name) {
      if (name === 'src') dispose();
      media.removeAttribute(name);
    },
  };
  const transport = new Proxy(controls, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'clockSource') return loop ? 'audio-context-pcm' : 'media-element';
      if (key === 'audible') return loop ? loop.audible : !media.paused;
      if (key === 'loopCycle') return loop?.cycle || 0;
      if (loop) {
        if (['currentTime', 'paused', 'duration'].includes(key)) return loop[key];
        if (key === 'src' || key === 'currentSrc') return id;
        if (key === 'readyState') return 4;
        if (key === 'seeking') return seeking;
        if (key === 'ended') return loop.ended;
        if (key === 'loop') return loop.repeat;
        if (key === 'muted') return muted;
      }
      const value = media[key];
      return typeof value === 'function' ? value.bind(media) : value;
    },
    set(target, key, value) {
      if (key === 'src') {
        dispose();
        media.src = value;
        return true;
      }
      if (key === 'muted') {
        muted = !!value;
        media.muted = muted;
        loop?.mute(muted);
        return true;
      }
      if (loop && key === 'currentTime') {
        seeking = true;
        loop.seek(value);
        emit('seeking');
        const request = generation,
          seek = ++seekCommand;
        Promise.resolve().then(() => {
          if (loop && generation === request && seek === seekCommand) {
            seeking = false;
            emit('seeked');
          }
        });
        return true;
      }
      if (loop && key === 'loop') return true;
      media[key] = value;
      return true;
    },
  });
  return transport;
}
