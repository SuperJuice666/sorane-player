export function createVocalMixer(audio) {
  let context,
    split,
    backing,
    vocals,
    narration,
    output,
    read = false,
    volume = 1,
    primed = false,
    resuming = null;
  function gains(smooth = false) {
    if (!context) return;
    const now = context.currentTime;
    // Separation and AAC reconstruction can exceed full scale. Keep linear
    // headroom after summing the stems, rather than clipping musical peaks.
    for (const [node, value] of [
      [backing, read ? 0 : 2],
      [vocals, read ? 0 : 2 * volume],
      [narration, read ? 1 : 0],
      [output, read ? 1 : 0.45],
    ]) {
      if (smooth) {
        if (node.gain.cancelAndHoldAtTime) node.gain.cancelAndHoldAtTime(now);
        else {
          const current = node.gain.value;
          node.gain.cancelScheduledValues(now);
          node.gain.setValueAtTime(current, now);
        }
        node.gain.linearRampToValueAtTime(value, now + 0.02);
      } else {
        node.gain.cancelScheduledValues(now);
        node.gain.setValueAtTime(value, now);
      }
    }
  }
  function initialize() {
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Web Audio unavailable');
      context = new Context();
      const source = context.createMediaElementSource(audio);
      split = context.createChannelSplitter(4);
      const back = context.createChannelMerger(2),
        voice = context.createChannelMerger(2);
      source.connect(split);
      split.connect(back, 0, 0);
      split.connect(back, 1, 1);
      split.connect(voice, 2, 0);
      split.connect(voice, 3, 1);
      backing = context.createGain();
      vocals = context.createGain();
      narration = context.createGain();
      output = context.createGain();
      output.channelCount = 2;
      output.channelCountMode = 'explicit';
      output.channelInterpretation = 'speakers';
      back.connect(backing);
      voice.connect(vocals);
      backing.connect(output);
      vocals.connect(output);
      source.connect(narration);
      narration.connect(output);
      output.connect(context.destination);
      gains();
    }
  }
  return {
    setRead(value) {
      read = value;
      gains();
    },
    setVolume(value) {
      volume = Math.max(0, Math.min(1, Number(value) || 0));
      gains(true);
    },
    getContext() {
      initialize();
      return context;
    },
    connectSource(node) {
      initialize();
      node.connect(split);
      node.connect(narration);
    },
    async resume() {
      initialize();
      // PCM playback should use the same media session category as a song played
      // through <audio>, including on iPhones with the silent switch enabled.
      try {
        if (window.navigator?.audioSession) window.navigator.audioSession.type = 'playback';
      } catch {}
      // Both calls happen synchronously in the play gesture, before any fetch,
      // decode, or promise continuation can consume that gesture on WebKit.
      if (!resuming && context.state !== 'running') {
        resuming = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Audio activation timed out')), 4000);
          Promise.resolve(context.resume()).then(
            () => {
              clearTimeout(timer);
              if (context.state !== 'running') reject(new Error('Audio output is not running'));
              else resolve();
            },
            (error) => {
              clearTimeout(timer);
              reject(error);
            },
          );
        })
          .catch((error) => {
            primed = false;
            throw error;
          })
          .finally(() => {
            resuming = null;
          });
      }
      if (!primed) {
        const source = context.createBufferSource();
        source.buffer = context.createBuffer(1, 1, context.sampleRate);
        source.connect(context.destination);
        source.onended = () => source.disconnect();
        source.start(0);
        primed = true;
      }
      return resuming || Promise.resolve();
    },
  };
}
