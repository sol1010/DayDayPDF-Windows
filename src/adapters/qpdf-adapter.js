import { createQpdfRunner } from 'qpdf-run';

const DEFAULT_ASSETS = Object.freeze({
  workerUrl: '/assets/qpdf/qpdf-worker.js',
  qpdfJsUrl: '/assets/qpdf/qpdf.js',
  wasmUrl: '/assets/qpdf/qpdf.wasm',
});

const EDIT_RESTRICTIONS = Object.freeze([
  '--modify=none',
  '--extract=n',
  '--print=full',
]);

function requireBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('PDF 데이터는 Uint8Array 또는 ArrayBuffer여야 합니다');
}

export function qpdfLockArguments({ openPassword = '', ownerPassword, restrictEditing = false } = {}) {
  if (typeof ownerPassword !== 'string' || !ownerPassword) {
    throw new TypeError('잠금 설정에는 관리자 암호가 필요합니다');
  }
  const permissions = restrictEditing ? EDIT_RESTRICTIONS : [];
  return [
    '--encrypt', String(openPassword), ownerPassword, '256',
    ...permissions,
    '--', 'input.pdf', 'output.pdf',
  ];
}

export function qpdfUnlockArguments(password = '') {
  return [`--password=${String(password)}`, '--decrypt', '--', 'input.pdf', 'output.pdf'];
}

export function createRandomOwnerPassword(cryptoObject = globalThis.crypto) {
  if (!cryptoObject?.getRandomValues) {
    throw new Error('이 브라우저에서는 안전한 암호 생성 기능을 사용할 수 없습니다');
  }
  const bytes = new Uint8Array(32);
  cryptoObject.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function createQpdfAdapter({
  createRunner = createQpdfRunner,
  workerUrl = DEFAULT_ASSETS.workerUrl,
  qpdfJsUrl = DEFAULT_ASSETS.qpdfJsUrl,
  wasmUrl = DEFAULT_ASSETS.wasmUrl,
  timeoutMs = 120000,
} = {}) {
  async function execute(input, args) {
    const runner = await createRunner({
      env: 'browser', workerUrl, qpdfJsUrl, wasmUrl, timeoutMs,
    });
    try {
      return await runner.runOne({
        input: requireBytes(input),
        inputName: 'input.pdf',
        outputName: 'output.pdf',
        args,
      });
    } finally {
      await runner.destroy();
    }
  }

  return Object.freeze({
    lock: (input, options) => execute(input, qpdfLockArguments(options)),
    unlock: (input, password = '') => execute(input, qpdfUnlockArguments(password)),
  });
}
