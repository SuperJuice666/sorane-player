import { renderFurigana } from './furigana.js';
import { alignReadings, balanceLyrics } from './layout.js';
export function createLyricsView({ current, next }) {
  const $ = (id) => document.getElementById(id);
  try {
    $('translation-toggle').checked = localStorage.getItem('lyrics-translation') === 'true';
  } catch {}
  const renderTranslation = () => {
    $('translation').textContent = current().translation || '';
    $('translation').hidden = !$('translation-toggle').checked;
  };
  try {
    $('next-line-toggle').checked = localStorage.getItem('lyrics-next-line') !== 'false';
  } catch {}
  $('mora-toggle').checked = true;
  try {
    $('mora-toggle').checked = localStorage.getItem('lyrics-mora') !== 'false';
  } catch {}
  $('kana-toggle').checked = false;
  try {
    $('kana-toggle').checked = localStorage.getItem('lyrics-kana') === 'true';
  } catch {}
  const renderJapanese = (node, token) => {
    node.lang = 'ja';
    if (renderFurigana) renderFurigana(node, token, $('kana-toggle').checked);
    else node.textContent = token.jp;
  };
  const displayRomaji = (token) => {
    if (!$('mora-toggle').checked) return token.romaji;
    const split = token.readingParts?.join(' ');
    const letters = (token.romaji.match(/[a-zāīūēō]/gi) || []).length;
    return split && letters >= 8 && split.split(' ').length >= 5
      ? split.trim().replace(/\s+/g, ' ')
      : token.romaji;
  };
  document.documentElement.classList.toggle('mora-enabled', $('mora-toggle').checked);
  function renderNextLine() {
    const following = next();
    $('next-line').hidden = !$('next-line-toggle').checked || !following;
    $('next-tokens').replaceChildren();
    if (!following) return;
    for (const token of following.tokens) {
      const word = document.createElement('span');
      word.className = 'next-word';
      const jp = document.createElement('span');
      jp.className = 'next-jp';
      renderJapanese(jp, token);
      const roma = document.createElement('span');
      roma.className = 'next-romaji';
      roma.textContent = token.romaji;
      word.append(jp, roma);
      $('next-tokens').append(word);
    }
    alignReadings([[...$('next-tokens').children]]);
  }
  $('next-line-toggle').addEventListener('change', () => {
    renderNextLine();
    try {
      localStorage.setItem('lyrics-next-line', String($('next-line-toggle').checked));
    } catch {}
  });
  $('translation-toggle').addEventListener('change', () => {
    renderTranslation();
    try {
      localStorage.setItem('lyrics-translation', String($('translation-toggle').checked));
    } catch {}
  });
  $('mora-toggle').addEventListener('change', () => {
    document.documentElement.classList.toggle('mora-enabled', $('mora-toggle').checked);
    document
      .querySelectorAll('.word .romaji')
      .forEach((node, i) => (node.textContent = displayRomaji(current().tokens[i])));
    renderNextLine();
    balanceLyrics($('tokens'));
    try {
      localStorage.setItem('lyrics-mora', String($('mora-toggle').checked));
    } catch {}
  });
  $('kana-toggle').addEventListener('change', () => {
    document
      .querySelectorAll('.word .jp')
      .forEach((node, i) => renderJapanese(node, current().tokens[i]));
    renderNextLine();
    balanceLyrics($('tokens'));
    try {
      localStorage.setItem('lyrics-kana', String($('kana-toggle').checked));
    } catch {}
  });

  return { renderTranslation, renderNextLine, renderJapanese, displayRomaji };
}
