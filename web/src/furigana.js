const hasKanji = (text) => /[一-龯々〆]/.test(text);
const hiragana = (text) =>
  text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function segments(token) {
  if (token.ruby) return token.ruby;
  if (!hasKanji(token.jp) || !token.kana) return [{ text: token.jp }];
  const parts = token.jp.match(/[一-龯々〆]+|[^一-龯々〆]+/g);
  // Literal kana anchor the readings. Dictionary-validated character boundaries
  // annotate compounds individually; irregular readings remain a single ruby.
  const pattern = parts.map((part) => (hasKanji(part) ? '(.+?)' : escape(hiragana(part)))).join('');
  const match = hiragana(token.kana).match(new RegExp('^' + pattern + '$'));
  if (!match) return [{ text: token.jp, reading: hiragana(token.kana) }];
  let group = 1;
  return parts.flatMap((part) => {
    if (!hasKanji(part)) return [{ text: part }];
    const reading = match[group++];
    return [{ text: part, reading }];
  });
}

export const renderFurigana = (node, token, enabled) => {
  node.replaceChildren();
  if (!enabled) {
    node.textContent = token.jp;
    return;
  }
  for (const segment of segments(token)) {
    if (!segment.reading) {
      const text = document.createElement('span');
      text.textContent = segment.text;
      node.append(text);
      continue;
    }
    const ruby = document.createElement('ruby');
    ruby.textContent = segment.text;
    const rt = document.createElement('rt');
    rt.textContent = segment.reading;
    ruby.append(rt);
    node.append(ruby);
  }
};
