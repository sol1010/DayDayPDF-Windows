const FREE = 0xffffffff;
const END = 0xfffffffe;
const FAT = 0xfffffffd;
const DIF = 0xfffffffc;
const bytes = size => new Uint8Array(size);
const view = data => new DataView(data.buffer, data.byteOffset, data.byteLength);
const words = count => { const data = bytes(count * 4); data.fill(255); return data; };

export function createCompoundFile(streams) {
  const entries = [{ name: 'Root Entry', type: 5, children: [], start: END, size: 0 }];
  const folders = new Map([['', entries[0]]]);
  let total = 0;
  for (const [path, data] of Object.entries(streams)) {
    if (!(data instanceof Uint8Array)) throw new TypeError('Compound streams must contain bytes');
    total += data.length;
    if (total > 160 * 1024 * 1024) throw new Error('HWP 결과가 너무 큽니다. PDF를 나눠서 변환하세요.');
    const names = path.split('/');
    let parent = entries[0];
    let prefix = '';
    names.forEach((name, index) => {
      if (!name || name.length > 31 || /[\x00\\:!]/.test(name)) throw new Error('Invalid compound stream name');
      prefix += (prefix ? '/' : '') + name;
      if (index < names.length - 1) {
        if (!folders.has(prefix)) {
          const folder = { name, type: 1, children: [], start: 0, size: 0 };
          folders.set(prefix, folder); entries.push(folder); parent.children.push(folder);
        }
        parent = folders.get(prefix);
      } else {
        const stream = { name, type: 2, data, start: END, size: data.length };
        entries.push(stream); parent.children.push(stream);
      }
    });
  }
  entries.forEach((entry, index) => { entry.index = index; entry.left = FREE; entry.right = FREE; entry.child = FREE; entry.color = 1; });
  for (const parent of entries.filter(e => e.children)) {
    const children = parent.children.sort((a, b) => a.name.length - b.name.length || (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1));
    let redLevel = 0;
    for (let n = children.length - 1; n >= 0; n = Math.floor(n / 2) - 1) redLevel++;
    function tree(low, high, depth) {
      if (high < low) return FREE;
      const mid = Math.floor((low + high) / 2);
      const node = children[mid];
      node.color = depth === redLevel ? 0 : 1;
      node.left = tree(low, mid - 1, depth + 1);
      node.right = tree(mid + 1, high, depth + 1);
      return node.index;
    }
    parent.child = tree(0, children.length - 1, 0);
  }
  const chunks = [];
  const chains = [];
  let sectorCount = 0;
  function allocate(data) {
    if (!data.length) return END;
    const count = Math.ceil(data.length / 512);
    const start = sectorCount;
    const padded = bytes(count * 512); padded.set(data);
    chunks.push(padded); chains.push({ start, count }); sectorCount += count;
    return start;
  }
  const small = entries.filter(e => e.type === 2 && e.size > 0 && e.size < 4096);
  const miniCount = small.reduce((sum, e) => sum + Math.ceil(e.size / 64), 0);
  const mini = bytes(miniCount * 64);
  const miniFat = words(Math.ceil(miniCount / 128) * 128);
  let miniIndex = 0;
  for (const entry of entries.filter(e => e.type === 2 && e.size >= 4096)) entry.start = allocate(entry.data);
  for (const entry of small) {
    const count = Math.ceil(entry.size / 64);
    entry.start = miniIndex; mini.set(entry.data, miniIndex * 64);
    for (let i = 0; i < count; i++) view(miniFat).setUint32((miniIndex + i) * 4, i + 1 === count ? END : miniIndex + i + 1, true);
    miniIndex += count;
  }
  entries[0].size = mini.length; entries[0].start = allocate(mini);
  const miniFatStart = allocate(miniFat);
  const directory = bytes(Math.ceil(entries.length / 4) * 512);
  const directoryView = view(directory);
  for (const entry of entries) {
    const offset = entry.index * 128;
    for (let i = 0; i < entry.name.length; i++) directoryView.setUint16(offset + i * 2, entry.name.charCodeAt(i), true);
    directoryView.setUint16(offset + 64, (entry.name.length + 1) * 2, true);
    directory[offset + 66] = entry.type; directory[offset + 67] = entry.color;
    for (const [relative, value] of [[68, entry.left], [72, entry.right], [76, entry.child], [116, entry.start], [120, entry.size]]) directoryView.setUint32(offset + relative, value, true);
  }
  const directoryStart = allocate(directory);
  let fatCount = 0; let difatCount = 0;
  while (true) {
    const nextFat = Math.ceil((sectorCount + fatCount + difatCount) / 128);
    const nextDifat = Math.ceil(Math.max(0, nextFat - 109) / 127);
    if (nextFat === fatCount && nextDifat === difatCount) break;
    fatCount = nextFat; difatCount = nextDifat;
  }
  const fatStart = sectorCount;
  const difatStart = fatStart + fatCount;
  const fat = words(fatCount * 128);
  const fatView = view(fat);
  for (const { start, count } of chains) for (let i = 0; i < count; i++) fatView.setUint32((start + i) * 4, i + 1 === count ? END : start + i + 1, true);
  for (let i = 0; i < fatCount; i++) fatView.setUint32((fatStart + i) * 4, FAT, true);
  for (let i = 0; i < difatCount; i++) fatView.setUint32((difatStart + i) * 4, DIF, true);
  const header = bytes(512);
  header.set([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
  const head = view(header);
  for (const [offset, value] of [[24, 0x3e], [26, 3], [28, 0xfffe], [30, 9], [32, 6]]) head.setUint16(offset, value, true);
  for (const [offset, value] of [[44, fatCount], [48, directoryStart], [56, 4096], [60, miniFatStart], [64, miniFat.length / 512], [68, difatCount ? difatStart : END], [72, difatCount]]) head.setUint32(offset, value, true);
  for (let i = 0; i < 109; i++) head.setUint32(76 + i * 4, i < fatCount ? fatStart + i : FREE, true);
  const difat = words(difatCount * 128);
  for (let i = 0; i < difatCount; i++) {
    for (let j = 0; j < 127; j++) {
      const index = 109 + i * 127 + j;
      view(difat).setUint32(i * 512 + j * 4, index < fatCount ? fatStart + index : FREE, true);
    }
    view(difat).setUint32(i * 512 + 508, i + 1 === difatCount ? END : difatStart + i + 1, true);
  }
  const output = bytes((sectorCount + fatCount + difatCount + 1) * 512);
  let offset = 0;
  for (const chunk of [header, ...chunks, fat, difat]) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
