export function hexToRgbComponents(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha === undefined ? 1 : alpha})`;
}

export function opOf(object, part) {
  return object[part] !== undefined ? object[part] : (object.op !== undefined ? object.op : 1);
}
