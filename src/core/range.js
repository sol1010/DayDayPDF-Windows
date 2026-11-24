export function parseRange(value, max) {
  const out = new Set();
  for (const part of value.split(',')) {
    if (!part.trim()) continue;
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) return null;
    let start = +match[1];
    let end = match[2] ? +match[2] : +match[1];
    if (start < 1 || end < 1 || start > max || end > max) return null;
    if (start > end) [start, end] = [end, start];
    for (let index = start; index <= end; index++) out.add(index - 1);
  }
  return out.size ? [...out].sort((a, b) => a - b) : null;
}
