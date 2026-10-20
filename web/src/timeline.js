/** Convert the single original-song timeline to a rendered recording's seconds. */
export function lineVariant(line, rate) {
  const origin = (line.clipStart ?? line.start) / rate;
  return {
    origin,
    start: line.start / rate,
    end: line.end / rate,
    clipEnd: (line.clipEnd ?? line.end) / rate,
    tokens: line.tokens.map((token) => ({
      start: token.start / rate - origin,
      end: token.end / rate - origin,
    })),
  };
}
