/** Render the lyric directory; selection decisions belong to the player. */
export function createDirectory({ context, chooseLine, chooseRange, chooseGroup }) {
  const list = document.getElementById('lyric-list');
  function highlight() {
    const { index, pending, inGap, playing } = context();
    for (const button of list.querySelectorAll('.line-button')) {
      const current = !pending && !inGap && Number(button.dataset.index) === index;
      button.classList.toggle('current', current);
      button.classList.toggle('is-playing', current && playing);
      button.setAttribute('aria-current', String(current));
    }
  }
  function render() {
    const { lines, mode, draft, prompt, rangeReady, rangeStart, rangeEnd } = context();
    list.replaceChildren();
    let section = null;
    for (const [index, line] of lines.entries()) {
      if (line.section !== section) {
        let last = index;
        while (last + 1 < lines.length && lines[last + 1].section === line.section) last++;
        const heading = document.createElement(mode === 'full' ? 'div' : 'button');
        heading.className = 'group-title';
        heading.textContent = line.section;
        if (mode !== 'full') {
          heading.type = 'button';
          heading.dataset.count = String(last - index + 1);
          heading.setAttribute('aria-label', `练习${line.section}，${last - index + 1}句`);
          heading.addEventListener('click', () => chooseGroup(index, last));
        }
        list.append(heading);
        section = line.section;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'line-button';
      button.dataset.index = index;
      button.classList.toggle(
        'in-range',
        mode === 'section' &&
          (draft === null
            ? !prompt && rangeReady && index >= rangeStart && index <= rangeEnd
            : index === draft),
      );
      button.classList.toggle('range-start', mode === 'section' && index === draft);
      const number = document.createElement('span');
      number.className = 'index';
      number.textContent = String(index + 1).padStart(2, '0');
      const text = document.createElement('span');
      text.className = 'line-snippet';
      text.textContent = line.jp;
      button.append(number, text);
      button.addEventListener('click', () =>
        context().mode === 'section' ? chooseRange(index) : chooseLine(index),
      );
      list.append(button);
    }
    highlight();
    document.getElementById('line-total').textContent =
      mode === 'section' && draft !== null
        ? `起始：第 ${draft + 1} 句`
        : mode === 'section' && !prompt && rangeReady
          ? `第 ${rangeStart + 1}–${rangeEnd + 1} 句`
          : `${lines.length} 句`;
  }
  return { render, highlight };
}
