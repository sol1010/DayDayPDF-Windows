import { createQpdfAdapter } from '../adapters/qpdf-adapter.js';

export async function secureEditorPdf(bytes, { mode, password }) {
  const adapter = createQpdfAdapter();
  try {
    if (mode === 'lock') {
      if (!password) throw new Error('설정할 암호를 입력하세요.');
      return await adapter.lock(bytes, { openPassword: password, ownerPassword: password });
    }
    return await adapter.unlock(bytes, password);
  } catch (error) {
    throw new Error(mode === 'unlock' ? '암호를 확인하세요. PDF를 해제하지 못했습니다.' : 'PDF에 암호를 설정하지 못했습니다. 문서 상태를 확인하세요.');
  }
}
