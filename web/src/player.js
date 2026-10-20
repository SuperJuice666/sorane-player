import { createDirectory } from './directory.js';
import { createVocalMixer } from './audio/mixer.js';
import { createPlaybackTransport } from './audio/transport.js';
import { createLyricsView } from './lyrics.js';
import { balanceLyrics } from './layout.js';
import { lineVariant } from './timeline.js';
export function createPlayer({ songs, cache, decoder }) {
  const availableLibrary = songs;
  let requestedSongId = null;
  try {
    requestedSongId = new URLSearchParams(window.location.search).get('song');
  } catch {}
  const linkedSong = availableLibrary.find((song) => song.id === requestedSongId),
    library = linkedSong ? [linkedSong] : availableLibrary;
  const $ = (id) => document.getElementById(id),
    media = $('audio'),
    vocalMixer = createVocalMixer(media),
    audio = createPlaybackTransport({
      media,
      mixer: vocalMixer,
      createChunkedSession: decoder.createSession,
    });
  let lesson = library[0],
    lines = lesson.lines;
  try {
    lesson = library.find((s) => s.id === localStorage.getItem('lyrics-song')) || lesson;
    lines = lesson.lines;
  } catch {}

  const preferenceKey = () => 'lyrics-practice-' + lesson.id;
  for (const song of library) {
    const option = document.createElement('option');
    option.value = song.id;
    option.textContent = song.title + ' · ' + song.artist;
    $('song-select').append(option);
  }
  $('song-select').value = lesson.id;
  $('song-select').disabled = !!linkedSong;
  document.documentElement.classList.toggle('single-song', !!linkedSong);
  document.title = lesson.title + ' · 歌词练习';
  const { renderTranslation, renderNextLine, renderJapanese, displayRomaji } = createLyricsView({
    current: () => lines[state.index],
    next: () => (state.segment && state.index >= state.rangeEnd ? null : lines[state.index + 1]),
  });
  const mobile = window.matchMedia('(max-width:700px)'),
    drawer = $('lyric-drawer');
  drawer.open = false;
  let pendingPracticeScope = null,
    playIntent = false,
    scrubbing = false,
    mediaWaiting = false;
  const state = {
    index: 0,
    mode: 'song',
    practiceMode: 'song',
    readSpeed: 'verySlow',
    songSpeed: 1,
    full: false,
    segment: false,
    rangeStart: 0,
    rangeEnd: 2,
    rangeReady: false,
    playGeneration: 0,
    inGap: false,
  };
  let vocalVolume = 100;
  try {
    const value = localStorage.getItem('lyrics-vocal-volume');
    if (value !== null && Number.isFinite(Number(value)))
      vocalVolume = Math.max(0, Math.min(100, Number(value)));
  } catch {}
  function updateVocalVolume() {
    vocalMixer?.setVolume(vocalVolume / 100);
    $('vocal-volume').value = vocalVolume;
    $('vocal-value').textContent = vocalVolume + '%';
    $('vocal-volume').setAttribute('aria-valuetext', vocalVolume + '%');
  }
  updateVocalVolume();
  $('vocal-volume').addEventListener('input', () => {
    vocalVolume = Number($('vocal-volume').value);
    updateVocalVolume();
    try {
      localStorage.setItem('lyrics-vocal-volume', String(vocalVolume));
    } catch {}
  });
  audio.preservesPitch = true;
  audio.mozPreservesPitch = true;
  audio.webkitPreservesPitch = true;
  const fmt = (seconds) => {
    if (!Number.isFinite(seconds)) return '--:--';
    const n = Math.max(0, Math.floor(seconds));
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  };
  let playbackError = false,
    loadingPhase = '';
  function renderLoadingStatus() {
    if (playbackError) {
      $('play').setAttribute('data-play-state', 'retry');
      $('play-label').textContent = '重试';
      $('play').setAttribute('title', $('status').textContent);
      return;
    }
    const message = pendingPracticeScope
      ? ''
      : pendingPlayback
        ? loadingPhase || '正在加载音频…'
        : mediaWaiting
          ? '正在缓冲音频…'
          : playIntent && audio.paused
            ? '正在启动播放…'
            : '';
    $('status').textContent = message;
    $('status').hidden = !message;
    $('play').setAttribute('title', '');
    if (message) {
      const label = message.includes('缓冲')
        ? '缓冲'
        : message.includes('解码')
          ? '解码'
          : message.includes('缓存')
            ? '读取'
            : message.includes('下载')
              ? '下载'
              : '加载';
      $('play-label').textContent = label;
      $('play').setAttribute('aria-label', label);
    }
    const label = $('play-label').textContent;
    $('play').setAttribute(
      'data-play-state',
      ['加载', '缓冲', '下载', '读取', '解码'].includes(label)
        ? 'loading'
        : label === '暂停'
          ? 'pause'
          : label === '重试'
            ? 'retry'
            : 'play',
    );
  }
  const status = (message, error = false) => {
    playbackError = error;
    $('status').hidden = !error;
    $('status').textContent = error ? message : '';
    $('status').classList.toggle('error', error);
    renderLoadingStatus();
  };
  let restorePracticeSource = false;
  function savePreferences() {
    try {
      localStorage.setItem('lyrics-song', lesson.id);
      localStorage.setItem(
        preferenceKey(),
        JSON.stringify({ readSpeed: state.readSpeed, songSpeed: state.songSpeed }),
      );
      localStorage.setItem(
        'lyrics-player-settings',
        JSON.stringify({
          scope: pendingPracticeScope || (state.segment ? 'section' : state.full ? 'full' : 'line'),
          practiceMode: state.practiceMode,
          readSpeed: state.readSpeed,
          songSpeed: state.songSpeed,
        }),
      );
    } catch {}
  }
  function restoreSpeeds(saved) {
    if (!saved || typeof saved !== 'object') return;
    if (['normal', 'slow', 'verySlow'].includes(saved.readSpeed)) state.readSpeed = saved.readSpeed;
    if ([0.5, 0.75, 1].includes(saved.songSpeed)) state.songSpeed = saved.songSpeed;
  }
  try {
    restoreSpeeds(JSON.parse(localStorage.getItem(preferenceKey()) || 'null'));
  } catch {}
  try {
    const saved = JSON.parse(localStorage.getItem('lyrics-player-settings') || 'null');
    if (saved && typeof saved === 'object') {
      if (['song', 'read'].includes(saved.practiceMode)) state.practiceMode = saved.practiceMode;
      restoreSpeeds(saved);
    }
  } catch {}
  const directory = createDirectory({
    context: () => ({
      lines,
      index: state.index,
      mode: pickerMode(),
      draft: rangeDraftStart,
      prompt: practicePrompt,
      rangeReady: state.rangeReady,
      rangeStart: state.rangeStart,
      rangeEnd: state.rangeEnd,
      pending: !!pendingPracticeScope,
      inGap: state.inGap,
      playing: !audio.paused && !audio.ended,
    }),
    chooseLine: choosePracticeLine,
    chooseRange: chooseRangeEndpoint,
    chooseGroup: (first, last) => {
      if (pickerMode() === 'section') {
        rangeDraftStart = first;
        chooseRangeEndpoint(last);
      } else choosePracticeLine(first);
    },
  });
  const renderList = () => directory.render();
  const renderDirectoryCurrent = () => directory.highlight();
  function renderLine() {
    $('instrumental').hidden = true;
    renderTranslation();
    renderNextLine();
    const line = lines[state.index];
    $('tokens').replaceChildren();
    for (const token of line.tokens) {
      const word = document.createElement('div');
      word.className = 'word';
      const jp = document.createElement('span');
      jp.className = 'jp';
      renderJapanese(jp, token);
      const roma = document.createElement('span');
      roma.className = 'romaji';
      roma.textContent = displayRomaji(token);
      word.append(jp, roma);
      $('tokens').append(word);
    }
    $('sentence-number').textContent =
      String(state.index + 1).padStart(2, '0') + ' / ' + lines.length;
    $('current-section').textContent = line.section;
    $('source-time').textContent = `${fmt(line.start)} – ${fmt(line.end)}`;
    $('prev').disabled = state.index <= (state.segment ? state.rangeStart : 0);
    $('next').disabled = state.index >= (state.segment ? state.rangeEnd : lines.length - 1);
    renderDirectoryCurrent();
    renderSelection();
    balanceLyrics($('tokens'));
  }
  function renderSelection() {
    const pending = !!pendingPracticeScope;
    $('lesson').hidden = pending;
    $('selection-empty').hidden = !pending;
    $('selection-caption').textContent =
      pendingPracticeScope === 'section' ? '从右上角歌词选择一个段落' : '从右上角歌词选择练习句';
    for (const id of ['prev', 'next', 'restart', 'progress'])
      $(id).disabled =
        pending ||
        (id === 'prev' && state.index <= (state.segment ? state.rangeStart : 0)) ||
        (id === 'next' && state.index >= (state.segment ? state.rangeEnd : lines.length - 1));
    for (const selector of ['[data-read-speed]', '[data-song-speed]'])
      document.querySelectorAll(selector).forEach((b) => (b.disabled = pending));
    for (const id of ['mode-song', 'mode-read'])
      $(id).disabled =
        pending ||
        state.full ||
        state.segment ||
        (id === 'mode-read' && !lines[state.index].narration);
    $('vocal-volume').disabled =
      pending || (state.mode === 'read' && !state.full && !state.segment);
    $('vocal-control').classList.toggle('unavailable', $('vocal-volume').disabled);
  }
  function renderMode() {
    const scope =
        pendingPracticeScope || (state.segment ? 'section' : state.full ? 'full' : 'line'),
      continuous = scope !== 'line',
      read = state.mode === 'read' && !continuous;
    $('mode-read').classList.toggle('active', read);
    $('mode-song').classList.toggle('active', !read);
    $('mode-read').setAttribute('aria-selected', String(read));
    $('mode-song').setAttribute('aria-selected', String(!read));
    $('audio-type').hidden = continuous;
    $('read-speeds').hidden = !read;
    $('song-speeds').hidden = read;
    $('scope-line').setAttribute('aria-pressed', String(scope === 'line'));
    $('scope-full').setAttribute('aria-pressed', String(scope === 'full'));
    $('scope-section').setAttribute('aria-pressed', String(scope === 'section'));
    $('practice-options').hidden = false;
    $('restart').hidden = false;
    $('player').classList.toggle('full-mode', scope === 'full');
    document
      .querySelectorAll('[data-read-speed]')
      .forEach((b) => b.classList.toggle('selected', b.dataset.readSpeed === state.readSpeed));
    document
      .querySelectorAll('[data-song-speed]')
      .forEach((b) =>
        b.classList.toggle('selected', Number(b.dataset.songSpeed) === state.songSpeed),
      );
    renderPlaying();
  }
  function renderPlaying() {
    renderSelection();
    renderDirectoryCurrent();
    const playing = playIntent,
      preparing = !!pendingPlayback;
    $('play').disabled = !!pendingPracticeScope;
    $('play-label').textContent =
      playing && preparing
        ? '加载'
        : playing && mediaWaiting
          ? '缓冲'
          : playing
            ? '暂停'
            : failedPosition !== null
              ? '重试'
              : preparing
                ? '加载'
                : '播放';
    $('play').setAttribute('aria-pressed', String(playing));
    $('play').setAttribute('aria-busy', String(preparing || mediaWaiting));
    $('play').setAttribute('aria-label', playing ? '暂停播放' : $('play-label').textContent);
    renderLoadingStatus();
    if (!playing)
      document.querySelectorAll('.word.playing').forEach((w) => w.classList.remove('playing'));
  }
  const songVariant = (line = lines[state.index]) => lineVariant(line, state.songSpeed);
  let pendingPlayback = null,
    pendingSeek = null,
    loadGeneration = 0,
    playbackSession = null,
    failedPosition = null,
    readingResource = null;
  const sectionBounds = () => ({
    start: songVariant(lines[state.rangeStart]).origin,
    end: songVariant(lines[state.rangeEnd]).clipEnd,
  });
  // The session owns the mapping between media seconds and original-song seconds.
  // Never infer this mapping from UI mode flags while a source is being replaced.
  const playbackPosition = () => audio.currentTime - (playbackSession?.windowStart || 0);
  const playbackDuration = () =>
    playbackSession?.segment ? playbackSession.duration / playbackSession.rate : audio.duration;
  const requestedPosition = () =>
    pendingPlayback?.seek ??
    (pendingSeek ? pendingSeek.time - (playbackSession?.windowStart || 0) : playbackPosition());
  const songPosition = (requested = false) =>
    playbackSession.songStart +
    (requested ? requestedPosition() : playbackPosition()) * playbackSession.rate;
  const sourceReady = () =>
    !!playbackSession &&
    playbackSession.generation === loadGeneration &&
    playbackSession.songId === lesson.id &&
    audio.readyState >= 1 &&
    (!('currentSrc' in audio) || audio.currentSrc === playbackSession.src);
  const seekPosition = (time) => {
    if (pendingPlayback) {
      pendingPlayback.seek = time;
      return;
    }
    seekAudio(time + (playbackSession?.windowStart || 0));
  };
  function settleSeek() {
    if (!pendingSeek) return true;
    if (!sourceReady() || audio.seeking || pendingSeek.issued === false) return false;
    if (pendingSeek.generation !== loadGeneration) {
      pendingSeek = null;
      return true;
    }
    // A queued completion can belong to an older seek. Only acknowledge the latest target.
    if (Math.abs(audio.currentTime - pendingSeek.time) > 0.025) {
      audio.currentTime = pendingSeek.time;
      return false;
    }
    pendingSeek = null;
    audio.muted = false;
    return true;
  }
  let rangeDraftStart = null,
    pickerScope = null,
    practicePrompt = false;
  const pickerMode = () =>
    pickerScope ||
    pendingPracticeScope ||
    (state.segment ? 'section' : state.full ? 'full' : 'line');
  function renderRanges() {
    const b = sectionBounds();
    $('section-summary').textContent =
      `第 ${state.rangeStart + 1}–${state.rangeEnd + 1} 句 · ${fmt(b.start * state.songSpeed)} – ${fmt(b.end * state.songSpeed)} · 循环播放`;
  }
  function renderRangePicker() {
    const mode = pickerMode();
    $('lyrics-title').textContent =
      mode === 'section' ? '选择练习段落' : mode === 'line' ? '选择练习段落' : '歌词目录';
    $('section-panel').hidden = mode === 'full';
    $('choose-section').hidden = mode !== 'section';
    $('section-summary').hidden = practicePrompt || mode !== 'section';
    $('range-instruction').textContent =
      mode === 'line'
        ? '选择段落从首句开始，也可直接选句'
        : rangeDraftStart === null
          ? '选择整个段落，或依次点起始句、结束句'
          : `已选第 ${rangeDraftStart + 1} 句 · 再点结束句`;
    const top = $('lyric-list').scrollTop;
    renderList();
    $('lyric-list').scrollTop = top;
  }
  function openLyrics(
    event,
    {
      scope = pendingPracticeScope || (state.segment ? 'section' : state.full ? 'full' : 'line'),
      guided = !!pendingPracticeScope,
    } = {},
  ) {
    pickerScope = scope;
    practicePrompt = guided;
    rangeDraftStart = null;
    renderRangePicker();
    drawer.showModal();
    drawer.focus({ preventScroll: true });
    document.documentElement.classList.toggle('lyrics-open', true);
    $('open-lyrics').setAttribute('aria-expanded', 'true');
    const index = pickerMode() === 'section' && state.rangeReady ? state.rangeStart : state.index;
    document.querySelectorAll('.line-button').forEach((b) => {
      if (Number(b.dataset.index) === index) {
        b.scrollIntoView({ block: 'center' });
        if (event?.detail === 0) b.focus({ preventScroll: true });
      }
    });
  }
  function choosePracticeLine(index) {
    const autoplay = !practicePrompt && playIntent;
    if (practicePrompt) {
      pendingPracticeScope = null;
      state.full = false;
      state.segment = false;
      state.mode = state.practiceMode = restorePracticeSource ? state.practiceMode : 'song';
    }
    restorePracticeSource = false;
    select(index, { autoplay });
    closeLyrics();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function closeLyrics() {
    drawer.close();
  }
  function openRangePicker() {
    rangeDraftStart = null;
    if (!drawer.open) openLyrics(undefined, { scope: 'section' });
    else renderRangePicker();
  }
  function beginPractice(scope) {
    pausePlayback();
    pendingPracticeScope = scope;
    restorePracticeSource = false;
    rangeDraftStart = null;
    renderMode();
    renderList();
    savePreferences();
  }
  function enterLine() {
    if (pendingPracticeScope || (!state.full && !state.segment)) {
      beginPractice('line');
      return;
    }
    updatePlayback();
    const resume = playIntent;
    state.playGeneration++;
    state.full = false;
    state.segment = false;
    state.mode = state.practiceMode = 'song';
    state.inGap = false;
    renderList();
    renderLine();
    loadAudio({ resume });
    savePreferences();
  }
  $('choose-lyrics').addEventListener('click', () => openLyrics());
  $('open-lyrics').addEventListener('click', openLyrics);
  $('close-lyrics').addEventListener('click', closeLyrics);
  drawer.addEventListener('close', () => {
    rangeDraftStart = null;
    pickerScope = null;
    practicePrompt = false;
    document.documentElement.classList.toggle('lyrics-open', false);
    $('open-lyrics').setAttribute('aria-expanded', 'false');
    $('open-lyrics').focus({ preventScroll: true });
  });
  drawer.addEventListener('click', (e) => {
    if (e.target !== drawer) return;
    const r = drawer.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      closeLyrics();
  });
  let sheetTouch = null;
  drawer.addEventListener(
    'touchstart',
    (e) => {
      if (
        !mobile.matches ||
        e.touches.length !== 1 ||
        e.target.closest('#close-lyrics,#choose-section')
      )
        return;
      const t = e.touches[0];
      sheetTouch = {
        x: t.clientX,
        y: t.clientY,
        canClose:
          !!e.target.closest('.lyrics-sheet-head') ||
          ($('lyric-list').contains(e.target) && $('lyric-list').scrollTop <= 0),
      };
    },
    { passive: true },
  );
  drawer.addEventListener(
    'touchend',
    (e) => {
      const start = sheetTouch;
      sheetTouch = null;
      if (!start?.canClose || !e.changedTouches.length) return;
      const t = e.changedTouches[0],
        dy = t.clientY - start.y;
      if (dy > 90 && Math.abs(t.clientX - start.x) < dy * 0.65) closeLyrics();
    },
    { passive: true },
  );
  drawer.addEventListener(
    'touchcancel',
    () => {
      sheetTouch = null;
    },
    { passive: true },
  );
  function chooseRangeEndpoint(index) {
    if (!Number.isInteger(index) || index < 0 || index >= lines.length) return;
    if (rangeDraftStart === null) {
      rangeDraftStart = index;
      renderRangePicker();
      return;
    }
    const resume = playIntent;
    pendingPracticeScope = null;
    if (!state.full && !state.segment) state.practiceMode = state.mode;
    state.full = false;
    state.segment = true;
    state.mode = 'song';
    state.rangeStart = Math.min(rangeDraftStart, index);
    state.rangeEnd = Math.max(rangeDraftStart, index);
    state.rangeReady = true;
    state.index = state.rangeStart;
    state.playGeneration++;
    rangeDraftStart = null;
    renderRanges();
    renderRangePicker();
    renderLine();
    loadAudio({ resume });
    savePreferences();
    closeLyrics();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function enterSection({ index } = {}) {
    pendingPracticeScope = null;
    if (state.segment) return;
    const resume = playIntent;
    if (!state.full) state.practiceMode = state.mode;
    if (!state.rangeReady) {
      state.rangeStart = state.index;
      state.rangeEnd = Math.min(lines.length - 1, state.index + 2);
      state.rangeReady = true;
    }
    state.playGeneration++;
    rangeDraftStart = null;
    state.segment = true;
    state.full = false;
    state.mode = 'song';
    state.inGap = false;
    state.index =
      index === undefined
        ? state.rangeStart
        : Math.max(state.rangeStart, Math.min(state.rangeEnd, index));
    const seek = index === undefined ? 0 : songVariant().start - sectionBounds().start;
    renderRanges();
    renderRangePicker();
    renderLine();
    loadAudio({ seek, resume });
    savePreferences();
  }
  function enterSectionScope() {
    if (
      !pendingPracticeScope &&
      !state.full &&
      !state.segment &&
      state.rangeReady &&
      state.index >= state.rangeStart &&
      state.index <= state.rangeEnd
    ) {
      enterSection({ index: state.index });
      return;
    }
    beginPractice('section');
  }

  const clearWordHighlight = () =>
    document.querySelectorAll('.word.playing').forEach((word) => word.classList.remove('playing'));
  function seekAudio(time) {
    clearWordHighlight();
    // Loading and seeking are asynchronous. Keep only the latest requested position.
    if (pendingPlayback) {
      pendingPlayback.seek = time;
      return;
    }
    if (!sourceReady()) {
      pendingPlayback = { seek: time - (playbackSession?.windowStart || 0), resume: playIntent };
      return;
    }
    const target = Math.max(
      0,
      Number.isFinite(audio.duration) ? Math.min(time, Math.max(0, audio.duration - 0.001)) : time,
    );
    // Even adjacent onsets can be less than a millisecond apart. Keep the seek
    // request until its completion so a queued old event cannot undo navigation.
    pendingSeek = { time: target, generation: loadGeneration, issued: false };
    audio.muted = true;
    audio.pause();
    pendingSeek.issued = true;
    audio.currentTime = target;
  }
  function currentSource() {
    return state.mode === 'read' && !state.full && !state.segment
      ? lines[state.index].narration[state.readSpeed].src
      : lesson.audio[String(state.songSpeed)].src;
  }

  function applyPlaybackSettings() {
    audio.defaultPlaybackRate = 1;
    audio.playbackRate = 1;
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
  }
  function loadAudio({ seek = 0, resume = false } = {}) {
    if (state.mode === 'read' && !lines[state.index].narration) {
      state.mode = state.practiceMode = 'song';
      seek = 0;
    }
    const generation = ++loadGeneration;
    failedPosition = null;
    playbackError = false;
    loadingPhase = '正在加载音频…';
    $('status').classList.toggle('error', false);

    pendingSeek = null;
    pendingPlayback = { seek, resume };
    playIntent = resume;
    mediaWaiting = false;
    audio.muted = true;
    audio.pause();
    audio.loop = false;
    const read = state.mode === 'read' && !state.full && !state.segment,
      rate = read ? 1 : state.songSpeed,
      bounds = state.segment ? sectionBounds() : null;
    vocalMixer?.setRead(read);
    playbackSession = {
      generation,
      songId: lesson.id,
      read,
      readSpeed: state.readSpeed,
      rate,
      continuous: state.full || state.segment,
      segment: state.segment,
      windowStart: 0,
      songStart:
        read || state.full ? 0 : state.segment ? bounds.start * rate : songVariant().origin * rate,
      duration: bounds ? (bounds.end - bounds.start) * rate : null,
      src: null,
    };
    const progress = ({ phase, percent }) => {
      if (generation !== loadGeneration) return;
      loadingPhase =
        phase === 'decode'
          ? '正在解码音频…'
          : phase === 'download'
            ? '正在下载音频' + (percent !== null ? ' ' + percent + '%' : '') + '…'
            : phase === 'cached'
              ? '正在读取缓存…'
              : '正在准备播放…';
      renderLoadingStatus();
    };
    if (readingResource) {
      readingResource.release();
      readingResource = null;
    }
    const src = currentSource();
    $('elapsed').textContent = '00:00';
    $('duration').textContent = '--:--';
    $('progress').value = 0;
    const attach = (url) => {
      if (generation !== loadGeneration) return;
      audio.src = url;
      playbackSession.src = audio.src;
      applyPlaybackSettings();
      audio.load();
      if (playIntent) startPlayback();
    };
    if (state.segment) {
      audio.removeAttribute('src');
      audio.load();
      Promise.resolve()
        .then(() =>
          decoder.range({
            src,
            start: bounds.start,
            end: bounds.end,
            isCurrent: () => generation === loadGeneration,
            onProgress: progress,
          }),
        )
        .then((data) => {
          if (generation !== loadGeneration) return;
          if (pendingPlayback?.seek > 0) pendingPlayback.seek += bounds.start - data.start;
          playbackSession.songStart = data.start * rate;
          playbackSession.duration = data.duration * rate;
          audio.attachLoop(data);
          playbackSession.src = audio.src;
          applyPlaybackSettings();
        })
        .catch(() => {
          if (generation !== loadGeneration) return;
          failedPosition = pendingPlayback?.seek || 0;
          pendingPlayback = null;
          pendingSeek = null;
          pausePlayback();
          audio.muted = false;
          status('选段音频准备失败，点击播放重试。', true);
          renderPlaying();
        });
    } else if (!read) {
      // All original recordings use the same PCM decoder and four-channel mixer.
      audio.removeAttribute('src');
      audio.load();
      (state.full ? decoder.full : decoder.range)({
        src,
        start: songVariant().origin,
        end: songVariant().clipEnd,
        isCurrent: () => generation === loadGeneration,
        onProgress: progress,
      })
        .then((data) => {
          if (generation !== loadGeneration) return;
          playbackSession.songStart = data.start * rate;
          audio.attachPCM(data, true);
          playbackSession.src = audio.src;
          applyPlaybackSettings();
        })
        .catch(() => {
          if (generation !== loadGeneration) return;
          failedPosition = pendingPlayback?.seek || 0;
          pendingPlayback = null;
          pendingSeek = null;
          pausePlayback();
          audio.muted = false;
          status('原曲音频准备失败，点击播放重试。', true);
          renderPlaying();
        });
    } else if (cache) {
      audio.removeAttribute('src');
      audio.load();
      cache
        .playable(src, { onProgress: progress })
        .then((resource) => {
          if (generation !== loadGeneration) {
            resource.release();
            return;
          }
          readingResource = resource;
          attach(resource.url);
        })
        .catch(() => {
          if (generation !== loadGeneration) return;
          failedPosition = pendingPlayback?.seek || 0;
          pendingPlayback = null;
          pendingSeek = null;
          pausePlayback();
          audio.muted = false;
          status('读音加载失败，点击重试。', true);
          renderPlaying();
        });
    } else attach(src);
    applyPlaybackSettings();
    renderMode();
  }

  function pausePlayback() {
    playIntent = false;
    state.playGeneration++;
    if (pendingPlayback) pendingPlayback.resume = false;
    audio.pause();
    renderPlaying();
  }
  async function startPlayback() {
    void cache?.persist?.();
    if (pendingPracticeScope) return;
    if (failedPosition !== null) {
      const seek = failedPosition;
      loadAudio({ seek, resume: true });
    }
    playIntent = true;
    if (pendingPlayback) pendingPlayback.resume = true;
    const generation = ++state.playGeneration,
      sourceGeneration = loadGeneration;
    const mixerReady = vocalMixer?.resume() || Promise.resolve();
    renderPlaying();
    if (scrubbing || pendingSeek || (pendingPlayback && !audio.getAttribute('src'))) {
      mixerReady.catch(() => {
        if (generation !== state.playGeneration || sourceGeneration !== loadGeneration) return;
        pausePlayback();
        status('请再次点击播放以启用音频。', true);
      });
      return;
    }
    audio.muted = !!pendingPlayback || !!pendingSeek;
    try {
      applyPlaybackSettings();
      await Promise.all([mixerReady, audio.play()]);
      if (sourceGeneration !== loadGeneration) return;
      if (!playIntent) {
        audio.pause();
        return;
      }
      if (generation !== state.playGeneration) return;
      status('');
      renderPlaying();
    } catch (error) {
      if (
        generation !== state.playGeneration ||
        sourceGeneration !== loadGeneration ||
        error.name === 'AbortError'
      )
        return;
      playIntent = false;
      if (pendingPlayback) pendingPlayback.resume = false;
      status('音频暂时无法播放，请重试或检查连接。', true);
      renderPlaying();
    }
  }

  function select(index, { autoplay = playIntent } = {}) {
    state.inGap = false;
    state.playGeneration++;
    state.index = Math.max(
      state.segment ? state.rangeStart : 0,
      Math.min(state.segment ? state.rangeEnd : lines.length - 1, index),
    );
    if (state.full || state.segment) {
      renderLine();
      savePreferences();
      if (state.segment) seekPosition(songVariant().start - sectionBounds().start);
      else seekAudio(songVariant().start);
      if (autoplay) startPlayback();
      return;
    }
    renderLine();
    loadAudio();
    savePreferences();
    status('点击播放，练习这一句。');
    if (autoplay) startPlayback();
  }
  function setMode(mode) {
    if (mode === 'read' && !lines[state.index].narration) return;
    if (mode === state.mode && !(mode === 'read' && state.full)) return;
    state.playGeneration++;
    const resume = playIntent;
    state.mode = mode;
    state.practiceMode = mode;
    if (mode === 'read') {
      state.full = false;
      state.segment = false;
    }
    loadAudio({ resume });
    savePreferences();
  }
  function setScope(full, { fromStart = false } = {}) {
    const selecting = !!pendingPracticeScope;
    pendingPracticeScope = null;
    if (full === state.full && !state.segment && !selecting) {
      renderLine();
      renderMode();
      return;
    }
    const resume = playIntent,
      position = playbackSession.read ? lines[state.index].start : songPosition(true),
      variant = songVariant();
    let seek;
    if (full) {
      if (!state.full && !state.segment) state.practiceMode = state.mode;
      seek = Math.max(position, lines[state.index].start) / state.songSpeed;
    } else {
      const relative = position - variant.origin * state.songSpeed;
      seek =
        state.practiceMode === 'song' &&
        relative >= 0 &&
        relative < (variant.clipEnd - variant.origin) * state.songSpeed
          ? relative / state.songSpeed
          : 0;
    }
    if (full && fromStart) {
      seek = 0;
      state.index = 0;
      state.inGap = false;
    }
    state.playGeneration++;
    state.full = full;
    state.segment = false;
    state.mode = full ? 'song' : state.practiceMode;
    renderList();
    renderLine();
    loadAudio({ seek, resume });
    savePreferences();
  }
  function setSongSpeed(speed) {
    if (speed === state.songSpeed) return;
    const position = songPosition(true),
      resume = playIntent;
    state.playGeneration++;
    state.songSpeed = speed;
    const origin = state.full
      ? 0
      : state.segment
        ? sectionBounds().start * speed
        : songVariant().origin * speed;
    loadAudio({ seek: Math.max(0, (position - origin) / speed), resume });
    if (state.segment) renderRanges();
    savePreferences();
  }
  $('mode-read').addEventListener('click', () => setMode('read'));
  $('mode-song').addEventListener('click', () => setMode('song'));
  $('play').addEventListener('click', () => {
    if (playIntent) pausePlayback();
    else startPlayback();
  });
  $('prev').addEventListener('click', () => select(state.index - 1));
  $('next').addEventListener('click', () => select(state.index + 1, { autoplay: !state.full }));
  $('restart').addEventListener('click', () => {
    if (state.full || state.segment) {
      select(state.index, { autoplay: true });
      return;
    }
    seekPosition(0);
    startPlayback();
  });

  function setReadSpeed(speed) {
    if (speed === state.readSpeed) return;
    const resume = playIntent;
    state.playGeneration++;
    state.readSpeed = speed;
    loadAudio();
    savePreferences();
    if (resume) startPlayback();
    else status('已切换朗读速度，下一次从句首播放。');
  }
  document
    .querySelectorAll('[data-read-speed]')
    .forEach((b) => b.addEventListener('click', () => setReadSpeed(b.dataset.readSpeed)));
  document
    .querySelectorAll('[data-song-speed]')
    .forEach((b) => b.addEventListener('click', () => setSongSpeed(Number(b.dataset.songSpeed))));
  $('scope-line').addEventListener('click', enterLine);
  $('scope-full').addEventListener('click', () =>
    setScope(true, { fromStart: !!pendingPracticeScope }),
  );
  $('scope-section').addEventListener('click', enterSectionScope);
  $('choose-section').addEventListener('click', openRangePicker);
  let scrubTarget = null;
  $('progress').addEventListener('pointerdown', () => {
    scrubbing = true;
    scrubTarget = null;
    audio.pause();
    clearWordHighlight();
  });
  const finishScrub = () => {
    if (!scrubbing) return;
    const target = scrubTarget;
    scrubbing = false;
    scrubTarget = null;
    if (target !== null) seekPosition(target);
    else if (playIntent) startPlayback();
    updatePlayback();
  };
  for (const event of ['pointerup', 'pointercancel', 'change'])
    $('progress').addEventListener(event, finishScrub);
  $('progress').addEventListener('input', () => {
    if (!Number.isFinite(playbackDuration())) return;
    const target = (Number($('progress').value) / 1000) * playbackDuration();
    if (scrubbing) {
      scrubTarget = target;
      return;
    }
    seekPosition(target);
  });
  audio.addEventListener('loadedmetadata', () => {
    if (!sourceReady()) return;
    applyPlaybackSettings();
    const song = state.full || state.segment || state.mode === 'song';
    $('duration').textContent = fmt(playbackDuration() * (song ? state.songSpeed : 1));
    const request = pendingPlayback;
    pendingPlayback = null;
    if (request?.seek > 0) seekPosition(request?.seek || 0);
    if (!pendingSeek) audio.muted = false;
    updatePlayback();
    renderPlaying();
    if (request?.resume && playIntent) startPlayback();
  });
  audio.addEventListener('play', () => {
    applyPlaybackSettings();
    renderPlaying();
  });
  audio.addEventListener('pause', renderPlaying);
  function updatePlayback() {
    // Never let an old clock sample overwrite the sentence selected by navigation.
    if (
      pendingPracticeScope ||
      pendingPlayback ||
      !sourceReady() ||
      !settleSeek() ||
      audio.seeking
    ) {
      clearWordHighlight();
      return;
    }
    const clock = audio.snapshot?.() || {
        time: audio.currentTime,
        audible: !audio.paused,
        source: 'media-element',
        cycle: 0,
      },
      position = clock.time - playbackSession.windowStart,
      time = playbackSession.read
        ? clock.time
        : playbackSession.songStart + position * playbackSession.rate;
    Object.assign($('player').dataset, {
      clockSource: clock.source,
      mediaTime: String(clock.time),
      songTime: String(time),
      loopCycle: String(clock.cycle),
    });
    $('elapsed').textContent = fmt(
      position * (state.full || state.segment || state.mode === 'song' ? state.songSpeed : 1),
    );
    if (!scrubbing && Number.isFinite(playbackDuration()))
      $('progress').value = Math.round((position / playbackDuration()) * 1000);
    if (playbackSession.continuous) {
      let low = 0,
        high = lines.length;
      // Audio clocks can round a seek a few milliseconds before the exact onset.
      while (low < high) {
        const mid = (low + high) >> 1;
        if (lines[mid].start <= time + 0.003) low = mid + 1;
        else high = mid;
      }
      const index = state.segment
        ? Math.max(state.rangeStart, Math.min(state.rangeEnd, low - 1))
        : Math.max(0, low - 1);
      if (index !== state.index) {
        state.index = index;
        renderLine();
        savePreferences();
      }
    }
    const line = lines[state.index],
      read = playbackSession.read,
      variant = lineVariant(line, playbackSession.rate),
      times = read ? line.narration?.[playbackSession.readSpeed]?.tokens : variant.tokens;
    const gap =
      playbackSession.continuous && (time < line.start - 0.025 || time > line.end + 0.025);
    if (gap !== state.inGap) {
      state.inGap = gap;
      renderDirectoryCurrent();
    }
    // Classify the complete gap in original-song seconds, clipped to the active practice range.
    const beforeLine = time < line.start,
      gapStart = beforeLine ? (lines[state.index - 1]?.end ?? 0) : line.end,
      gapEnd = beforeLine ? line.start : (lines[state.index + 1]?.start ?? lesson.duration);
    const windowStart = playbackSession.segment ? playbackSession.songStart : 0,
      windowEnd = playbackSession.segment
        ? playbackSession.songStart + playbackSession.duration
        : lesson.duration;
    $('instrumental').hidden =
      !gap || Math.min(gapEnd, windowEnd) - Math.max(gapStart, windowStart) < 2;
    // Word maps belong to the exact rendered recording, including its speed.
    // Convert the shared song clock back to that recording's local clip seconds.
    const t = read ? time : time / playbackSession.rate - variant.origin;
    document
      .querySelectorAll('.word')
      .forEach((word, i) =>
        word.classList.toggle(
          'playing',
          clock.audible !== false &&
            !audio.paused &&
            !audio.muted &&
            !mediaWaiting &&
            !scrubbing &&
            !!times?.[i] &&
            t >= times[i].start &&
            t < times[i].end,
        ),
      );
  }
  let playbackFrame = null;
  function animatePlayback() {
    updatePlayback();
    if (!audio.paused && !audio.ended) playbackFrame = requestAnimationFrame(animatePlayback);
    else playbackFrame = null;
  }
  audio.addEventListener('play', () => {
    if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
    animatePlayback();
  });
  audio.addEventListener('waiting', () => {
    mediaWaiting = true;
    clearWordHighlight();
    renderPlaying();
  });
  audio.addEventListener('playing', () => {
    if (!sourceReady()) return;
    mediaWaiting = false;
    renderPlaying();
    updatePlayback();
    if (playbackFrame === null && !audio.paused) animatePlayback();
  });
  audio.addEventListener('pause', () => {
    if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
    playbackFrame = null;
    updatePlayback();
  });
  audio.addEventListener('timeupdate', updatePlayback);
  audio.addEventListener('seeking', clearWordHighlight);
  audio.addEventListener('seeked', () => {
    if (!sourceReady() || !settleSeek()) return;
    updatePlayback();
    if (playIntent && audio.paused) startPlayback();
  });

  // PCM repeats on its sample clock; native narration restarts without reloading.
  audio.addEventListener('ended', () => {
    if (
      !playIntent ||
      !audio.ended ||
      pendingPlayback ||
      pendingSeek ||
      !sourceReady() ||
      pendingPracticeScope
    )
      return;
    seekPosition(0);
    startPlayback();
  });
  audio.addEventListener('error', () => {
    if (!playbackSession || (audio.currentSrc && audio.currentSrc !== playbackSession.src)) return;
    if (pendingPlayback && !audio.getAttribute('src')) return;
    failedPosition = Math.max(0, requestedPosition() || 0);
    pendingPlayback = null;
    pendingSeek = null;
    pausePlayback();
    audio.muted = false;
    status('音频加载失败，点击播放重试。', true);
  });
  // Keyboard transport shares the same controls, disabled bounds and audio clock.
  document.addEventListener('keydown', (e) => {
    if (
      e.defaultPrevented ||
      e.isComposing ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.shiftKey ||
      e.target.isContentEditable ||
      e.target.matches(
        'textarea,input:not([type]),input[type=text],input[type=search],input[type=email],input[type=url],input[type=password],input[type=number]',
      )
    )
      return;
    const key = e.code;
    if (
      !['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyR'].includes(key) ||
      drawer.open ||
      document.getElementById('song-picker').open
    )
      return;
    e.preventDefault();
    if (pendingPracticeScope) return;
    if (e.repeat && (key === 'Space' || key === 'KeyR')) return;
    const control = { Space: 'play', ArrowLeft: 'prev', ArrowRight: 'next', KeyR: 'restart' }[key];
    if (control) {
      if (!$(control).disabled) $(control).click();
      return;
    }
    const up = key === 'ArrowUp',
      read = !state.full && !state.segment && state.mode === 'read';
    const speeds = read ? ['verySlow', 'slow', 'normal'] : [0.5, 0.75, 1],
      current = read ? state.readSpeed : state.songSpeed;
    const index = Math.max(0, Math.min(speeds.length - 1, speeds.indexOf(current) + (up ? 1 : -1)));
    if (read) setReadSpeed(speeds[index]);
    else setSongSpeed(speeds[index]);
  });
  // Release transport controls after pointer clicks; text fields keep their input focus.
  document.addEventListener('click', (e) => {
    const control = e.target.closest(
      'button,input[type=checkbox],input[type=radio],input[type=range]',
    );
    if (e.detail > 0 && control && document.activeElement === control) control.blur();
  });
  $('song-select').addEventListener('change', () => {
    $('song-select').blur?.();
  });
  $('song-select').addEventListener('change', () => {
    const scope =
      pendingPracticeScope || (state.segment ? 'section' : state.full ? 'full' : 'line');
    savePreferences();
    pausePlayback();
    state.playGeneration++;
    lesson = library.find((s) => s.id === $('song-select').value);
    lines = lesson.lines;
    state.index = 0;
    state.inGap = false;
    state.full = scope === 'full';
    state.segment = false;
    state.rangeReady = false;
    state.rangeStart = 0;
    state.rangeEnd = Math.min(2, lines.length - 1);
    rangeDraftStart = null;
    pickerScope = null;
    practicePrompt = false;
    pendingPracticeScope = scope === 'full' ? null : scope;
    state.mode = state.practiceMode = 'song';
    try {
      localStorage.setItem('lyrics-song', lesson.id);
    } catch {}
    document.title = lesson.title + ' · 歌词练习';
    renderList();
    renderLine();
    loadAudio();
    status('');
    savePreferences();
  });
  function initializePlayer() {
    // Reload settings only. Lyrics, ranges and playback positions start fresh.
    state.index = 0;
    state.rangeStart = 0;
    state.rangeEnd = Math.min(2, lines.length - 1);
    state.rangeReady = false;
    state.segment = false;
    state.full = true;
    restorePracticeSource = false;
    state.mode = 'song';
    pendingPracticeScope = null;
    renderList();
    renderLine();
    loadAudio();
  }
  initializePlayer();
}
