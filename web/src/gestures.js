export function bindGestures() {
  // WebKit can rubber-band the viewport even when html/body overflow is hidden.
  // Only lyric panels own vertical scrolling; range inputs own their native drag.
  let gesture = null;
  document.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) {
        gesture = null;
        return;
      }
      const touch = event.touches[0],
        target = event.target.nodeType === 3 ? event.target.parentElement : event.target;
      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        lastY: touch.clientY,
        axis: null,
        range: !!target.closest?.('input[type="range"]'),
        scroller: target.closest?.('.workspace,#lyric-list,.catalog-scroll') || null,
      };
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (event) => {
      if (
        !gesture ||
        event.touches.length !== 1 ||
        gesture.range ||
        Math.abs((window.visualViewport?.scale || 1) - 1) > 0.01
      )
        return;
      const touch = event.touches[0],
        dx = touch.clientX - gesture.x,
        dy = touch.clientY - gesture.y,
        step = touch.clientY - gesture.lastY;
      gesture.lastY = touch.clientY;
      if (!gesture.axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
        gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      const panel = gesture.scroller,
        max = panel ? panel.scrollHeight - panel.clientHeight : 0;
      const blocked =
        gesture.axis === 'x' ||
        !panel ||
        max <= 1 ||
        (step > 0 && panel.scrollTop <= 0) ||
        (step < 0 && panel.scrollTop >= max - 1);
      if (blocked && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
  for (const type of ['touchend', 'touchcancel'])
    document.addEventListener(
      type,
      () => {
        gesture = null;
      },
      { passive: true },
    );
}
