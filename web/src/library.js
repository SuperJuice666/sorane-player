export function createSongPicker(library) {
  const $ = (id) => document.getElementById(id),
    select = $('song-select'),
    trigger = $('open-songs'),
    dialog = $('song-picker');
  if (!select || !trigger || !dialog) return;
  const songs = library,
    key = 'lyrics-favorites-v1';
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const normalize = (s) =>
    s
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 96))
      .replace(/[^\p{L}\p{N}]/gu, '');
  const loadFavorites = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  };
  let favorites = loadFavorites(),
    tab = 'favorites';
  function current() {
    return songs.find((s) => s.id === select.value);
  }
  function updateTrigger() {
    const song = current();
    $('song-picker-label').textContent = song ? `${song.title} · ${song.artist}` : '选择歌曲';
    trigger.disabled = select.disabled;
    trigger.setAttribute(
      'aria-label',
      song ? `选择歌曲，当前 ${song.title} · ${song.artist}` : '选择歌曲',
    );
  }
  function message(text = '') {
    $('catalog-status').textContent = text;
  }
  function icon(kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      p = document.createElementNS(svg.namespaceURI, 'path');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    p.setAttribute(
      'd',
      kind === 'star'
        ? 'm12 3 2.8 5.68 6.27.91-4.54 4.42 1.07 6.24L12 17.3l-5.6 2.95 1.07-6.24L2.93 9.59l6.27-.91Z'
        : 'M6 6l12 12M18 6 6 18',
    );
    svg.append(p);
    return svg;
  }
  function choose(id) {
    const song = songs.find((s) => s.id === id);
    if (!song) return;
    if (select.disabled && id !== select.value) {
      location.href = '/?song=' + encodeURIComponent(id);
      return;
    }
    if (id !== select.value) {
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    dialog.close();
    updateTrigger();
  }
  function saveFavorites() {
    try {
      localStorage.setItem(key, JSON.stringify([...favorites]));
      message('');
    } catch {
      message('无法保存收藏，请检查浏览器存储权限');
    }
  }
  function star(song) {
    const b = el('button', undefined, 'catalog-star');
    b.type = 'button';
    b.append(icon('star'));
    const refresh = () => {
      b.setAttribute('aria-pressed', String(favorites.has(song.id)));
      b.setAttribute('aria-label', (favorites.has(song.id) ? '取消收藏 ' : '收藏 ') + song.title);
    };
    refresh();
    b.addEventListener('click', () => {
      favorites.has(song.id) ? favorites.delete(song.id) : favorites.add(song.id);
      saveFavorites();
      if (tab === 'favorites') renderLibrary();
      else refresh();
    });
    return b;
  }
  function renderLibrary() {
    const target = $('catalog-library-list'),
      query = $('catalog-query').value.trim().split(/\s+/).filter(Boolean).map(normalize);
    const allowed = new Set([...select.options].map((o) => o.value));
    const matches = songs.filter(
      (s) =>
        allowed.has(s.id) &&
        (tab !== 'favorites' || favorites.has(s.id)) &&
        query.every((q) => normalize(s.title + ' ' + s.artist).includes(q)),
    );
    const byName = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
    const favoriteOrder = new Map([...favorites].map((id, index) => [id, index]));
    matches.sort((a, b) =>
      tab === 'favorites'
        ? favoriteOrder.get(b.id) - favoriteOrder.get(a.id)
        : byName.compare(a.title, b.title) ||
          byName.compare(a.artist, b.artist) ||
          a.id.localeCompare(b.id),
    );
    if (!matches.length) {
      const favoriteView = tab === 'favorites',
        box = el('div', undefined, 'catalog-empty');
      box.append(
        el(
          'p',
          favoriteView
            ? query.length
              ? '收藏中没有找到这首歌'
              : '还没有收藏歌曲'
            : '全部歌曲中没有找到这首歌',
        ),
      );
      if (favoriteView) {
        box.append(el('p', '在全部歌曲中点击星标，就能收藏常听的歌', 'catalog-guide-copy'));
        const action = el('button', '浏览全部歌曲', 'catalog-guide-action');
        action.type = 'button';
        action.addEventListener('click', () => setTab('library'));
        box.append(action);
      }
      target.replaceChildren(box);
      return;
    }
    target.replaceChildren();
    for (const song of matches) {
      const row = el(
          'div',
          undefined,
          'catalog-row' + (song.id === select.value ? ' current' : ''),
        ),
        button = el('button', undefined, 'catalog-main');
      button.type = 'button';
      button.append(el('strong', song.title), el('span', song.artist, 'catalog-meta'));
      button.addEventListener('click', () => choose(song.id));
      row.append(button);
      if (song.id === select.value) row.append(el('span', '当前', 'catalog-current'));
      row.append(star(song));
      target.append(row);
    }
  }
  function setTab(next) {
    tab = next;
    for (const b of dialog.querySelectorAll('[data-catalog-tab]'))
      b.setAttribute('aria-selected', String(b.dataset.catalogTab === tab));
    message('');
    renderLibrary();
  }
  trigger.addEventListener('click', () => {
    if (trigger.disabled) return;
    if (!dialog.open) dialog.showModal();
    setTab(tab);
    trigger.setAttribute('aria-expanded', 'true');
    $('close-songs').focus({ preventScroll: true });
  });
  $('close-songs').append(icon('close'));
  $('close-songs').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  });
  for (const b of dialog.querySelectorAll('[data-catalog-tab]'))
    b.addEventListener('click', () => setTab(b.dataset.catalogTab));
  $('catalog-query').addEventListener('input', renderLibrary);
  select.addEventListener('change', () => {
    updateTrigger();
    if (dialog.open) renderLibrary();
  });
  addEventListener('storage', (e) => {
    if (e.key === key) {
      favorites = loadFavorites();
      if (dialog.open) renderLibrary();
    }
  });
  updateTrigger();
}
