// Keep the minimum row count, then minimize differences between row widths.
export function planRows(widths, available, gap = 0) {
  if (!widths.length) return [];
  const n = widths.length,
    prefix = [0];
  for (const width of widths) prefix.push(prefix.at(-1) + Math.min(width, available));
  const span = (a, b) => prefix[b] - prefix[a] + gap * Math.max(0, b - a - 1);
  let rows = 1,
    start = 0;
  for (let i = 1; i < n; i++)
    if (span(start, i + 1) > available + 0.1) {
      rows++;
      start = i;
    }
  const target = (prefix[n] + gap * (n - rows)) / rows;
  const costs = Array.from({ length: rows + 1 }, () => Array(n + 1).fill(Infinity)),
    cuts = Array.from({ length: rows + 1 }, () => Array(n + 1).fill(-1));
  costs[0][0] = 0;
  for (let r = 1; r <= rows; r++)
    for (let end = r; end <= n; end++)
      for (let begin = end - 1; begin >= r - 1; begin--) {
        const width = span(begin, end);
        if (width > available + 0.1) break;
        const cost = costs[r - 1][begin] + (width - target) ** 2;
        if (cost < costs[r][end]) {
          costs[r][end] = cost;
          cuts[r][end] = begin;
        }
      }
  const result = [];
  let end = n;
  for (let r = rows; r > 0; r--) {
    const begin = cuts[r][end];
    if (begin < 0) return [Array.from({ length: n }, (_, i) => i)];
    result.unshift(Array.from({ length: end - begin }, (_, i) => begin + i));
    end = begin;
  }
  return result;
}

export function alignReadings(rows) {
  const groups = rows.map((row) =>
    row
      .map((word) => {
        if (!word.style || !word.querySelector) return null;
        word.style.gridTemplateRows = '';
        const jp = word.querySelector('.jp,.next-jp');
        return jp ? { word, jp } : null;
      })
      .filter(Boolean),
  );
  // Measure natural ruby height first; reserve the same first grid track for
  // every word in that visual row. Romanization starts on one shared baseline.
  const heights = groups.map((group) =>
    Math.ceil(Math.max(0, ...group.map(({ jp }) => jp.getBoundingClientRect().height))),
  );
  groups.forEach((group, i) => {
    if (heights[i] > 0)
      for (const { word } of group) word.style.gridTemplateRows = heights[i] + 'px auto';
  });
}

function balance(container) {
  if (!container || !container.getClientRects().length) return;
  const words = [...container.querySelectorAll('.word')];
  if (!words.length) return;
  const style = getComputedStyle(container),
    available =
      container.clientWidth -
      parseFloat(style.paddingLeft || 0) -
      parseFloat(style.paddingRight || 0),
    gap = parseFloat(style.columnGap) || 0;
  if (available <= 0) return;
  container.replaceChildren(...words);
  const rows = planRows(
    words.map((word) => word.getBoundingClientRect().width),
    available,
    gap,
  );
  if (rows.length < 2) {
    alignReadings([words]);
    return;
  }
  container.replaceChildren(
    ...rows.map((indices) => {
      const row = document.createElement('div');
      row.className = 'lyric-row';
      row.append(...indices.map((i) => words[i]));
      return row;
    }),
  );
  alignReadings(rows.map((indices) => indices.map((i) => words[i])));
}
export const balanceLyrics = (container) => {
  balance(container);
  const next = document.getElementById('next-tokens');
  if (next) alignReadings([[...next.children]]);
}; // Measure and commit in the same task, before the browser paints.

export function observeLyrics() {
  const container = document.getElementById('tokens');
  let width = -1;
  if (window.ResizeObserver)
    new ResizeObserver((entries) => {
      for (const entry of entries)
        if (Math.abs(entry.contentRect.width - width) > 0.5) {
          width = entry.contentRect.width;
          balanceLyrics(container);
        }
    }).observe(container);
  else window.addEventListener('resize', () => balanceLyrics(container));
  document.fonts?.ready.then(() => balanceLyrics(container));
  document.fonts?.addEventListener?.('loadingdone', () => balanceLyrics(container));
}
