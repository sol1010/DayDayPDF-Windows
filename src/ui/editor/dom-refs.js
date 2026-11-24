export const EDITOR_DOM_IDS = Object.freeze([
  'btnPdfLock', 'btnPdfUnlock',
  'btnDraw', 'drawingBar', 'inkColor', 'tbInkBrush',
  'appVer', 'betaTag', 'btnAppend', 'btnBlank', 'btnConnectArrow', 'btnFit', 'btnFitPage', 'btnOpen', 'btnOrig',
  'btnDocumentTools', 'btnPrint', 'btnRedo', 'btnRegion', 'btnRotL', 'btnRotR', 'btnSave', 'btnSaveAs', 'btnSearch',
  'btnSettings', 'btnShape', 'btnTabList', 'btnText', 'btnThumbs', 'btnUndo',
  'btnZoomIn', 'btnZoomOut', 'closeDocCancel', 'closeDocMessage',
  'closeDocOk', 'closeDocSave', 'closeDocSaveAs', 'closeDocOverlay', 'crCancel', 'crCanvas', 'crInfo', 'crOk',
  'crOverlay', 'crRect', 'crReset', 'crScroll', 'crStage', 'ctxMenu', 'dropHint', 'exCancel',
  'exCount', 'exDel', 'exImage', 'exOverlay', 'exPdf', 'fileInput', 'imgCrCancel', 'imgCrImage',
  'fontPicker', 'fontPickerCategory', 'fontPickerClose', 'fontPickerCount', 'fontPickerList',
  'fontPickerSearch', 'fontPickerTabs', 'imgCrOk', 'imgCrOverlay', 'imgCrRect', 'imgCrStage',
  'lockBar', 'lockBarClose',
  'lockBarUnlock', 'mgAdd', 'mgCancel', 'mgDialog', 'mgDrop', 'mgFile', 'mgList', 'mgOk',
  'mgOverlay', 'moCancel', 'moCount', 'moMerge', 'moOverlay', 'moTabs', 'objConnectArrowMi', 'objCropMi',
  'objMenu', 'objPasteMi', 'objPolylineAddPointMi', 'objPolylineCloseMi', 'objPolylineRemovePointMi',
  'pageJump', 'pagesBox', 'pageTotal', 'palCustom', 'palEyedropper', 'palSampleSurface',
  'palDrag', 'palettePop', 'palGrid', 'palHue', 'palPicker', 'palRecent',
  'palRecentWrap', 'palSV', 'palSVDot', 'pgNext', 'pgPrev', 'prCancel', 'prCustom',
  'prCustomRow', 'prInfo', 'printFrame', 'prMode', 'prOk', 'prOrient', 'prOverlay',
  'prPreviewNav', 'prPreviewPrev', 'prPreviewNext', 'prPreviewPage', 'prPreviewTotal', 'prPreviewSource', 'prPreviewZoom', 'prPreviewStatus', 'prPrevBox', 'prPreview', 'prPrevLabel', 'prDesktopOptions', 'prPrinter', 'prCopies', 'prColor', 'prDuplex', 'prPaper', 'documentLicenseText', 'prRange', 'regionBar', 'regionCancel',
  'regionCopyCommit', 'searchBar',
  'safeSaveCancel', 'safeSaveMessage', 'safeSaveOk', 'safeSaveOverlay', 'safeSaveTitle',
  'saveErrorMessage', 'saveErrorOk', 'saveErrorOverlay', 'saveErrorTitle',
  'setTutorialStart',
  'setCancel', 'setDupQ', 'setGlassEffect', 'setUpdateGroup', 'setAutoUpdate', 'setUpdateCheck', 'setUpdateStatus', 'setFontCacheDel', 'setFontCacheInfo', 'setKeyConflictSummary',
  'setLicenseAppVer', 'setOverlay', 'setRecDel', 'setRecInfo', 'setRecOpen', 'setReset', 'setSave',
  'setStartupMode', 'sfClose',
  'sfCount', 'sfInput', 'sfNext', 'sfPrev', 'shapeMenu', 'sidebar', 'sideGrip',
  'shapeTextBar', 'spinner', 'spinnerMsg', 'stAlign', 'stBold', 'stColor', 'stColorOp',
  'stFile', 'stFont', 'stFontButton', 'stFontLabel', 'stPin', 'stPinIcon', 'stSel', 'stSize', 'stValign',
  'szCancel', 'szCount', 'szCustomRow',
  'szH', 'szOk', 'szOrient', 'szOverlay', 'szPreset', 'szReset', 'szW', 'tabbar',
  'tabCount', 'tabList', 'tabMenu', 'tabMoveTargets', 'tabStrip', 'tbAlign', 'tbBold', 'tbColor',
  'tbArrowCtl', 'tbArrowEnd', 'tbArrowHead', 'tbArrowHeadCtl', 'tbColorOp', 'tbConnectorStyle',
  'tbDelete', 'tbFill', 'tbFillCtl', 'tbFillOn', 'tbFillOp', 'tbFont', 'tbFontButton', 'tbFontLabel',
  'tbImgCrop', 'tbLineCap', 'tbPin',
  'tbPinIcon', 'tbShapeCtl', 'tbSize', 'tbStroke', 'tbStrokeOn', 'tbStrokeOp',
  'tbSw', 'tbTextCtl', 'tbValign', 'textBar', 'toast', 'viewer', 
  'windowsAccessBar', 'windowsAccessMessage', 'zoomInput',
]);

export function createDomRefs(documentObject, requiredIds = EDITOR_DOM_IDS) {
  const elements = new Map();
  const missing = [];
  for (const id of requiredIds) {
    const element = documentObject.getElementById(id);
    if (element) elements.set(id, element);
    else missing.push(id);
  }
  if (missing.length) throw new Error(`필수 DOM 요소가 없습니다: ${missing.join(', ')}`);

  function get(id) {
    const element = elements.get(id);
    if (!element) throw new Error(`검증되지 않은 DOM 요소입니다: ${id}`);
    return element;
  }

  return Object.freeze({ get, has: id => elements.has(id), ids: Object.freeze([...elements.keys()]) });
}
