import { createAudioCache } from './audio/cache.js';
import { createDecoder } from './audio/decoder.js';
import { createChunkedAudio } from './audio/chunks.js';
import { createPlayer } from './player.js';
import { createSongPicker } from './library.js';
import { observeLyrics } from './layout.js';
import { bindGestures } from './gestures.js';

async function json(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Unable to load ${url} (${response.status})`);
  return response.json();
}

async function start() {
  const catalog = await json('library.json');
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.songs) || !catalog.songs.length) {
    throw new Error(
      'Build a music library with python -m lyric_player demo and python -m lyric_player build.',
    );
  }
  const cache = createAudioCache();
  const decoder = createChunkedAudio({
    cache,
    decoder: createDecoder(cache),
    manifests: catalog.chunks || {},
  });
  createPlayer({ songs: catalog.songs, cache, decoder });
  createSongPicker(catalog.songs);
  observeLyrics();
  bindGestures();
}

start().catch((error) => {
  document.getElementById('player').hidden = true;
  document.getElementById('lesson').hidden = true;
  document.getElementById('selection-empty').hidden = false;
  document.getElementById('choose-lyrics').textContent = '重新加载';
  document.getElementById('choose-lyrics').addEventListener('click', () => location.reload());
  document.getElementById('selection-caption').textContent =
    '曲库加载失败，请检查构建结果和网络连接。';
  console.error(error);
});
