import test from 'node:test';
import assert from 'node:assert/strict';
import { lineVariant } from '../web/src/timeline.js';
import { planRows } from '../web/src/layout.js';

test('all speeds map to the same original word and clip boundaries', () => {
  const line = {
    start: 17.5,
    end: 22.7,
    clipStart: 17.45,
    clipEnd: 22.8,
    tokens: [
      { start: 17.5, end: 18.1 },
      { start: 19.3, end: 22.7 },
    ],
  };
  for (const rate of [0.5, 0.75, 1]) {
    const variant = lineVariant(line, rate);
    assert.equal(variant.origin * rate, line.clipStart);
    for (let i = 0; i < line.tokens.length; i++) {
      for (const edge of ['start', 'end']) {
        assert(
          Math.abs((variant.tokens[i][edge] + variant.origin) * rate - line.tokens[i][edge]) <
            1e-10,
        );
      }
    }
    assert.equal(variant.clipEnd * rate, line.clipEnd);
  }
});

test('balanced rows preserve words and stay within the available width', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const widths = Array.from(
      { length: 1 + (seed % 12) },
      (_, i) => 20 + ((seed * 71 + i * 33) % 180),
    );
    const available = 240 + (seed % 300),
      gap = 8;
    const rows = planRows(widths, available, gap);
    assert.deepEqual(
      rows.flat(),
      widths.map((_, i) => i),
    );
    for (const row of rows)
      assert(
        row.reduce((sum, i) => sum + widths[i], 0) + gap * (row.length - 1) <= available + 0.1,
      );
  }
});
