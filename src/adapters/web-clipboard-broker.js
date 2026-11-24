const RECORD_VERSION = 1;
const RECORD_KEY = 'web:clipboard:latest:v1';
const CHANNEL_NAME = 'pdf-editor-web-clipboard-v1';
const MAX_PACKET_BYTES = 1024 * 1024 * 1024;

function validId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{8,100}$/i.test(value);
}

function packetBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function normalizeRecord(value) {
  if (!value || value.version !== RECORD_VERSION || !validId(value.id) ||
      !['pages', 'object'].includes(value.kind)) return null;
  const packet = packetBytes(value.packet);
  if (!packet || packet.byteLength <= 0 || packet.byteLength > MAX_PACKET_BYTES) return null;
  return Object.freeze({
    version: RECORD_VERSION,
    id: value.id,
    kind: value.kind,
    timestamp: Number(value.timestamp) || 0,
    meta: value.meta && typeof value.meta === 'object' ? { ...value.meta } : {},
    packet: packet.slice(),
  });
}

export function createWebClipboardBroker({
  repository,
  BroadcastChannelConstructor = globalThis.BroadcastChannel,
  cryptoObject = globalThis.crypto,
  now = () => Date.now(),
} = {}) {
  if (!repository || typeof repository.put !== 'function' || typeof repository.get !== 'function') {
    throw new TypeError('웹 클립보드 저장소가 필요합니다');
  }

  let latestMeta = null;
  let channel = null;
  try {
    if (typeof BroadcastChannelConstructor === 'function') {
      channel = new BroadcastChannelConstructor(CHANNEL_NAME);
      channel.addEventListener?.('message', event => {
        const value = event?.data;
        if (!value || value.protocol !== CHANNEL_NAME || !validId(value.id) ||
            !['pages', 'object'].includes(value.kind)) return;
        latestMeta = Object.freeze({
          id: value.id,
          kind: value.kind,
          timestamp: Number(value.timestamp) || 0,
          meta: value.meta && typeof value.meta === 'object' ? { ...value.meta } : {},
        });
      });
    }
  } catch {
    channel = null;
  }

  function makeId() {
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
      return cryptoObject.randomUUID();
    }
    return `clip-${now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  async function put(kind, packet, meta = {}, { id = null } = {}) {
    if (!['pages', 'object'].includes(kind)) {
      throw new TypeError('지원하지 않는 웹 클립보드 종류입니다');
    }
    const bytes = packetBytes(packet);
    if (!bytes || bytes.byteLength <= 0 || bytes.byteLength > MAX_PACKET_BYTES) {
      throw new RangeError('웹 클립보드 데이터 크기가 올바르지 않습니다');
    }
    if (id !== null && !validId(id)) throw new TypeError('웹 클립보드 식별자가 올바르지 않습니다');
    const record = {
      version: RECORD_VERSION,
      id: id || makeId(),
      kind,
      timestamp: now(),
      meta: meta && typeof meta === 'object' ? { ...meta } : {},
      packet: bytes.slice(),
    };
    await repository.put(RECORD_KEY, record);
    latestMeta = Object.freeze({
      id: record.id,
      kind: record.kind,
      timestamp: record.timestamp,
      meta: { ...record.meta },
    });
    try {
      channel?.postMessage({ protocol: CHANNEL_NAME, ...latestMeta });
    } catch {}
    return latestMeta;
  }

  async function get({ id = null, kind = null } = {}) {
    const record = normalizeRecord(await repository.get(RECORD_KEY));
    if (!record || (id && record.id !== id) || (kind && record.kind !== kind)) return null;
    latestMeta = Object.freeze({
      id: record.id,
      kind: record.kind,
      timestamp: record.timestamp,
      meta: { ...record.meta },
    });
    return record;
  }

  return Object.freeze({
    put,
    get,
    createId: makeId,
    latest: () => latestMeta,
    dispose() {
      try {
        channel?.close();
      } catch {}
      channel = null;
    },
  });
}

export const WEB_CLIPBOARD_RECORD_KEY = RECORD_KEY;
