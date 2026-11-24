import { EXTRA_TRANSLATIONS } from './extra-locales.js';
const STORAGE_KEY = 'daydaypdf.language';
const KOREAN = /[가-힣]/;

const EXACT = new Map(Object.entries({
  '자동 업데이트': 'Automatic updates',
  '새 정식 버전을 받아 마지막 창을 닫을 때 설치합니다.': 'Download stable releases and install when the last window closes.',
  '지금 확인': 'Check now',
  '꺼짐': 'Off',
  '새 버전 확인 중…': 'Checking for updates…',
  '설치 파일 다운로드 중…': 'Downloading the installer…',
  '사용 가능한 새 버전이 없습니다.': 'No newer release is available.',
  '다운로드 완료 · 앱을 닫으면 설치합니다.': 'Downloaded. The update will install when you exit.',
  '업데이트를 확인하지 못했습니다. 다시 시도하세요.': 'Could not check for an update. Try again.',
  '설치본에서 사용할 수 있습니다.': 'Available in the installed Windows app.',
  '자동 (원본 크기)': 'Automatic (original page size)',
  '인쇄 준비 중 · Esc로 취소': 'Preparing to print · Esc to cancel',
  '인쇄 취소 중…': 'Canceling print…',
  'PDF 저장 중 · Esc로 취소': 'Saving PDF · Esc to cancel',
  '프린터 전송 중 · Esc로 남은 전송 취소': 'Sending to printer · Esc cancels remaining jobs',
  '인쇄를 취소했습니다.': 'Printing canceled.',
  '남은 인쇄를 취소했습니다. 전송된 작업은 대기열에서 확인하세요.': 'Remaining jobs canceled. Check the queue for submitted jobs.',
  '구성요소 라이선스 원문 (QuickJS · OCR · 문서 변환)': 'Component licenses (QuickJS, OCR, and document conversion)',
  '스포이드': 'Eyedropper',
  '스포이드 · 클릭해서 색상 추출 (Esc로 취소)': 'Eyedropper · Click to pick a color (Esc to cancel)',
  '원하는 색상을 클릭하세요. Esc로 취소합니다.': 'Click a color to sample it. Press Esc to cancel.',
  '색상을 읽을 수 없습니다. 다시 시도해 주세요.': 'Could not read the color. Please try again.',
  "인쇄 면": "Sides",
  "단면 인쇄": "One-sided printing",
  "양면 · 긴 쪽 넘김": "Two-sided · long edge",
  "양면 · 짧은 쪽 넘김": "Two-sided · short edge",
  "미리보기 페이지 이동": "Preview page navigation",
  "인쇄 범위 내 미리보기 순서": "Preview position in the print range",
  "원본 페이지": "Source page",
  "개 페이지 인쇄": "pages to print",
  "미리보기 준비 중…": "Preparing preview…",
  "미리보기를 표시하지 못했습니다.": "Could not display the preview.",
  "열린 문서 추가": "Add open documents",
  "열린 문서": "Open documents",
  "선택한 문서 추가": "Add selected documents",
  "저장 전 편집 내용까지 포함합니다.": "Includes unsaved edits.",
  "문서 목록을 불러오는 중…": "Loading open documents…",
  "열려 있는 문서가 없습니다.": "No documents are open.",
  "문서 목록을 불러오지 못했습니다.": "Could not load the document list.",
  "열린 문서를 추가하는 중…": "Adding open documents…",
  "열린 문서를 찾을 수 없습니다.": "The open document was not found.",
  "열린 문서를 불러올 수 없습니다.": "Could not load the open document.",
  "열린 문서 응답 시간이 초과되었습니다.": "The open document did not respond in time.",
  "암호 설정하여 저장": "Set password and save",
  "암호 해제하여 저장": "Remove password and save",
  "현재 편집 내용을 포함한 PDF에 열기 암호를 설정해 사본으로 저장합니다.": "Set an opening password on the edited PDF and save a copy.",
  "암호를 입력해 암호 없는 사본을 저장합니다. 이미 해제된 문서는 암호를 비워도 됩니다.": "Enter the password to save an unlocked copy. Leave it blank if the document is already unlocked.",
  "PDF 파일 추가": "Add PDF file",
  "PDF 파일을 선택하세요.": "Choose a PDF file.",
  "선택한 PDF에서 문자 인식을 실행합니다. 스캔 이미지의 모양을 유지하며 검색용 텍스트를 추가합니다.": "Recognize text in the selected PDF, preserving scanned images and adding searchable text.",
  "선택한 PDF의 페이지를 이미지로 저장합니다. 여러 페이지는 ZIP 파일로 저장합니다.": "Save the selected PDF pages as images. Multiple pages are saved in a ZIP file.",
  "선택한 PDF에 열기 암호를 설정해 사본으로 저장합니다.": "Set an opening password on the selected PDF and save a copy.",
  "다른 이름으로": "Save as",
  "다른 이름으로 저장": "Save as",
  "프린터": "Printer",
  "프린터 불러오는 중…": "Loading printers…",
  "매수": "Copies",
  "컬러": "Color printing",
  "흑백": "Black and white",
  "양면": "Duplex",
  "단면": "Single-sided",
  "긴 쪽 넘김": "Flip on long edge",
  "짧은 쪽 넘김": "Flip on short edge",
  "설치된 프린터가 없습니다.": "No printers are installed.",
  "프린터 목록을 불러오지 못했습니다:": "Could not load the printer list:",
  "인쇄한 PDF를 새 탭으로 열었습니다.": "Printed PDF opened in a new tab.",
  "PDF를 저장했습니다.": "The PDF was saved.",
  "프린터로 보냈습니다.": "Sent to the printer.",
  "투명도": "Opacity",
  "그리기": "Draw",
  "그리기 옵션": "Drawing options",
  "붓": "Brush",
  "붓 종류": "Brush type",
  "펜": "Pen",
  "연필": "Pencil",
  "마커": "Marker",
  "두께": "Width",
  "색상": "Color",
  "붓 두께 (pt)": "Brush width (pt)",
  "붓 두께 · 휠로 조절": "Brush width · adjust with the wheel",
  "붓 색상": "Brush color",
  "붓 불투명도": "Brush opacity",
  "그리기 완료 (Esc)": "Finish drawing (Esc)",
  "완료 후 그린 선을 선택해 이동·수정할 수 있습니다.": "After finishing, select a stroke to move or edit it.",
  "두 손가락으로 화면 이동·확대/축소": "Use two fingers to pan and zoom",

  "도구모음 표시": "Toolbar display",
  "도구모음 크기": "Toolbar size",
  "작게 (기본)": "Small (default)",
  "보통": "Medium",
  "크게": "Large",
  "아이콘만": "Icons only",
  "아이콘 + 설명": "Icons + labels",
  "다운로드": "Download",
  "암호 설정": "Set password",
  "암호 해제": "Remove password",
  "화면 맞춤": "Fit page",
  "현재 페이지 전체를 화면에 맞춤": "Fit the whole current page in the view",
  "튜토리얼": "Tutorial",
  "실제 화면에서 주요 기능을 짧게 안내합니다.": "A brief guide to the main controls on your screen.",
  "시작하기": "Get started",
  "썸네일": "Thumbnails",
  "PDF 암호 설정": "Set PDF password",
  "PDF 암호 해제": "Remove PDF password",
  "글자 추가": "Add text",
  "여러 PDF": "Multiple PDFs",
  "이미지 변환": "Image conversion",
  "작업 전에": "Before you",
  "확인하세요.": "get started.",
  "OCR·문서·이미지 변환": "OCR, document and image conversion",
  "변환": "Convert",
  "작업": "Task",
  "OCR · 검색 가능한 PDF": "OCR · Searchable PDF",
  "PDF → PNG 이미지": "PDF to PNG images",
  "PDF → JPG 이미지": "PDF to JPG images",
  "문서 선택": "Choose a document",
  "변환하여 저장": "Convert and save",
  "결과 PDF 열기": "Open converted PDF",
  "결과 PDF를 새 탭으로 열었습니다.": "Converted PDF opened in a new tab.",
  "결과 PDF를 열지 못했습니다. 다시 시도하세요.": "Could not open the converted PDF. Please try again.",
  "균형 · 240 DPI": "Balanced · 240 DPI",
  "정밀 · 300 DPI": "Accurate · 300 DPI",
  "빠르게 · 180 DPI": "Fast · 180 DPI",
  "현재 편집 내용을 포함해 문자 인식을 실행합니다. 스캔 이미지의 모양을 유지하며 검색용 텍스트를 추가합니다.": "Recognize text in the current edited document, preserving scanned images and adding searchable text.",
  "페이지 모양을 유지해 이미지로 슬라이드에 배치하고, 인식한 텍스트를 별도 개체로 포함합니다.": "Place page images on slides to preserve their appearance and include recognized text as a separate object.",
  "인식한 텍스트를 Word 문서에 저장합니다. 원본의 이미지와 문단 배치는 유지되지 않습니다.": "Save recognized text in a Word document. Original images and paragraph layout are not preserved.",
  "인식한 텍스트를 페이지별 시트에 저장합니다. 이미지·표 서식·수식은 자동 복원되지 않습니다.": "Save recognized text in a sheet for each page. Images, table formatting and formulas are not reconstructed.",
  "각 페이지를 이미지로 배치한 HWP 파일을 만듭니다. HWP 안에서 글자를 직접 수정할 수 없습니다.": "Create an HWP file with a page image on each page. Text cannot be edited directly in the HWP file.",
  "현재 편집 내용을 포함해 페이지를 PNG 이미지로 저장합니다. 여러 페이지는 ZIP 파일로 저장합니다.": "Save edited pages as PNG images. Multiple pages are saved in a ZIP file.",
  "현재 편집 내용을 포함해 페이지를 JPG 이미지로 저장합니다. 여러 페이지는 ZIP 파일로 저장합니다.": "Save edited pages as JPG images. Multiple pages are saved in a ZIP file.",
  "DOCX·XLSX·PPTX·HWPX 문서를 PDF로 변환합니다. 글꼴·복잡한 서식은 원본과 다를 수 있습니다.": "Convert DOCX, XLSX, PPTX and HWPX documents to PDF. Fonts and complex formatting may differ from the original.",
  "PDF → 한글(HWP)": "PDF to HWP",
  "본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.": "This product was developed with reference to Hancom’s public HWP document file (.hwp) specification.",
  "HWP로 저장할 수 없는 용지 크기입니다. 최대 한 변 1m까지 지원합니다.": "This page size cannot be saved as HWP. Each side must be no longer than 1 meter.",
  "페이지 이미지 용량이 120MB를 넘었습니다. PDF를 나누거나 화질을 낮춰 변환하세요.": "Page images exceed 120 MB. Split the PDF or choose a lower image quality.",
  "페이지 이미지를 만들 수 없습니다.": "Unable to create a page image.",
  '한 시트에서 표시되는 열은 40개까지 지원합니다. 필요한 열만 남긴 사본으로 변환하세요.': 'Up to 40 visible columns per sheet are supported. Convert a copy containing only the columns you need.',
  '일부 그림은 지원하지 않는 형식이거나 외부 연결이므로 포함되지 않습니다.': 'Some images are excluded because their format is unsupported or they are externally linked.',
  '표 안의 그림과 세로 병합은 정확히 재현되지 않습니다.': 'Images within tables and vertical cell merges may not be reproduced accurately.',
  '구역별 서식·머리말·꼬리말·자동 번호는 원본과 다를 수 있습니다.': 'Section formatting, headers, footers and automatic numbering may differ from the original.',
  'Excel의 세로 병합 셀은 첫 번째 행에 표시합니다.': 'Vertically merged Excel cells are displayed in their first row.',
  'Excel의 차트·그림·도형은 포함되지 않습니다. 셀 내용과 표를 변환합니다.': 'Excel charts, images and shapes are excluded. Cell contents and tables are converted.',
  'Excel 수식은 파일에 저장된 계산 결과를 사용하며 다시 계산하지 않습니다.': 'Excel formulas use saved calculation results and are not recalculated.',
  'PPT의 그룹 도형은 지원하지 않습니다. 그룹을 해제한 파일로 변환하세요.': 'Grouped PowerPoint shapes are unsupported. Ungroup them before converting.',
  '마스터에 배치된 PPT 요소는 일부 표시되지 않습니다.': 'Some PowerPoint elements positioned by the slide master are not displayed.',
  'PPT 그림 자르기와 회전은 원본과 다를 수 있습니다.': 'PowerPoint image cropping and rotation may differ from the original.',
  'PPT의 표·차트·SmartArt는 지원하지 않습니다.': 'PowerPoint tables, charts and SmartArt are unsupported.',
  '회전한 PPT 요소의 배치는 원본과 다를 수 있습니다.': 'The placement of rotated PowerPoint elements may differ from the original.',
  '한글의 본문·기본 표·그림을 변환합니다. 원본 글꼴·세부 서식·떠 있는 개체 배치는 달라질 수 있습니다.': 'Converts HWPX text, basic tables and images. Fonts, detailed formatting and floating object placement may differ.',
  '대체 글꼴에 없는 일부 문자는 □로 표시됩니다.': 'Characters unavailable in the substitute font are displayed as □.',
  '일부 슬라이드 텍스트가 페이지 범위를 넘어 표시되지 않습니다.': 'Some slide text extends beyond the page and is not displayed.',
  '손상되었거나 지원하지 않는 그림이 제외되었습니다.': 'A damaged or unsupported image was excluded.',
  '문서는 30MB 이하만 지원합니다.': 'Documents up to 30 MB are supported.',
  '변환할 시트를 선택하세요.': 'Choose at least one sheet to convert.',
  '계산 결과가 저장되지 않은 수식이 있습니다. Excel에서 계산 후 저장한 파일을 선택하세요.': 'Some formulas have no saved result. Calculate and save the workbook in Excel before converting.',
  "문서 → PDF": "Documents to PDF",
  "PDF → PPT": "PDF to PowerPoint",
  "PDF → Word": "PDF to Word",
  "PDF → Excel": "PDF to Excel",
  '선택한 글꼴을 적용했습니다': 'The selected font has been applied.',
  '글꼴을 불러오지 못했습니다. 인터넷 연결을 확인한 후 다시 시도하세요': 'Could not load the font. Check your internet connection and try again.',
  'OCR 텍스트를 수정했습니다': 'OCR text updated.',
  'OCR 원본 유지 편집에서는 글자 불투명도를 유지합니다': 'OCR appearance editing preserves the original text opacity.',
  'OCR 수정 실패:': 'OCR edit failed:',
  '글자 위치와 글꼴을 분석합니다. 최초 분석에는 시간이 걸릴 수 있습니다': 'Analyzing character positions and fonts. The first analysis may take a moment.',
  'OCR 글자 수정': 'Edit OCR text',
  'OCR 텍스트 수정 불가': 'OCR text cannot be edited',
  'OCR 분석을 완료하지 못했습니다': 'OCR analysis could not be completed',
  '이 OCR 텍스트는 수정할 수 없습니다. 원본 모양을 유지하기 어렵습니다': 'This OCR text cannot be edited while preserving its original appearance.',
  '원본 모양을 유지하기 어려운 문장입니다. 검색과 복사는 계속 사용할 수 있습니다': 'This sentence cannot be edited while preserving its appearance. You can still search and copy the text.',
  'OCR 문장': 'OCR sentence',
  '비슷한 글꼴: ': 'Closest font: ',
  ' · 굵기 ': ' · Weight ',
  '모양 비교': 'Visual match',
  '글꼴 분석 중': 'Analyzing font',
  '수정하지 않은 글자는 원본을 유지합니다. Enter 적용 · Esc 취소': 'Unchanged characters keep their original appearance. Enter to apply · Esc to cancel',
  '한 번에 수정할 수 있는 문장은 1,000자까지입니다': 'Edit up to 1,000 characters at a time.',
  '비교할 글꼴을 불러오지 못했습니다. 인터넷 연결을 확인하세요': 'Could not load fonts for comparison. Check your internet connection.',
  '선택한 글꼴에 입력한 글자가 없습니다': 'The selected font does not contain an entered character.',
  '수정한 글자가 원래 문장 영역을 벗어납니다. 내용을 줄여 주세요': 'The edited text exceeds the sentence area. Shorten the text.',
  'OCR 편집 영역이 너무 큽니다': 'The OCR editing area is too large.',
  '원본 문서가 닫혔습니다': 'The original document was closed.',
  '검색 텍스트 교체 실패': 'Could not replace the search text.',
  '수정한 글자가 옆 글자와 겹칩니다. 내용을 조정해 주세요': 'The edited text overlaps an adjacent character. Adjust the text.',
  '수정한 글자가 주변 내용과 겹칩니다. 내용을 줄여 주세요': 'The edited text overlaps nearby content. Shorten the text.',
  '지원 글꼴로 텍스트를 수정했습니다': 'Text updated using a supported font.',
  'PDF 한 개를 선택하거나 끌어다 놓으세요': 'Choose or drop one PDF',
  'PDF 저장을 시작했습니다.': 'Saving the PDF.',
  '문서 열기': 'Open document',
  '도형 그리기': 'Draw shapes',
  '원본 편집': 'Edit original content',
  '모바일': 'Mobile',
  '도구': 'Tools',
  '페이지 삭제': 'Delete pages',
  '변환': 'Convert',
  '자동복구': 'Auto recovery',
  '바로 시작': 'Quick start',
  'JPG 이미지로 저장합니다.': 'and save them as JPG images.',
  'PDF 암호 설정': 'Protect PDF with a password',
  'PDF 암호 해제': 'Remove PDF password',
  '축소': 'Zoom out',
  '확대': 'Zoom in',
  '설정 분류': 'Settings categories',
  '예: 1-3, 5, 7': 'Example: 1-3, 5, 7',
  'Ctrl+휠로 확대/축소': 'Ctrl+wheel to zoom',
  '너비': 'Width',
  '높이': 'Height',
  '를 확인하세요.': '.',
  'PDF 여는 중...': 'Opening PDF…',
  '여러 파일을 한 번에 끌어놓으면 각각 탭으로 열립니다 (Ctrl+드롭 = 현재 문서 끝에 추가)': 'Dropping multiple files opens each one in a separate tab (Ctrl-drop appends them to the current document)',
  '· 페이지:': '· Pages:',
  '문서를 새 창으로 옮기는 중...': 'Moving the document to a new window…',
  '문서를 열지 못했습니다': 'Could not open the document.',
  '문서를 원래 창으로 합쳤습니다': 'Merged the document back into the original window.',
  '목록에서 제거': 'Remove from list',
  '파일명': 'File name',
  '경로': 'Path',
  '브라우저 보안상 폴더 경로를 확인할 수 없습니다.': 'The browser does not expose the folder path.',
  '탭 닫기 (휠클릭)': 'Close tab (middle-click)',
  '툴바 위치 고정 해제': 'Unpin toolbar position',
  '🎨 직접 선택…': '🎨 Choose a custom color…',
  '[파일 추가]로 병합할 PDF를 선택하세요': 'Select [Add files] to choose PDFs to merge.',
  '이 문서 안의 다른 위치로 이동': 'Go to another location in this document',
  '저장된 복구 데이터 없음': 'No saved recovery data',
  '저장된 복구 데이터를 삭제할까요?': 'Delete the saved recovery data?',
  '암호를 입력하세요': 'Enter the password',
  '다시 입력하세요.': 'Enter it again.',
  '편집 제한 암호(소유자 암호)를 입력하세요': 'Enter the editing-restriction password (owner password)',
  '사각형': 'rectangle',
  '사각형·원·삼각형·별 중 하나를 선택하세요': 'Select a rectangle, circle, triangle, or star.',
  '사각형·원·삼각형·별에만 연결 화살표를 붙일 수 있습니다': 'Connector arrows can attach only to rectangles, circles, triangles, or stars.',
  '연결 화살표 추가됨 — 바깥쪽 끝을 끌어 방향을 바꿀 수 있습니다': 'Connector arrow added — drag the outer end to change its direction.',
  '연결할 사각형·원·삼각형·별을 클릭하세요 (Esc 취소)': 'Select a rectangle, circle, triangle, or star to connect (Esc to cancel).',
  '도형 쪽 끝 이동: 연결 유지 · Shift: 중앙 자석 모드': 'Move the shape end: keep connected · Shift: center snap mode',
  '선택한 오브젝트 전체 크기 조절': 'Resize all selected objects',
  '가장자리 연결 유지 · Shift: 면 중앙 맞춤': 'Keep edge connection · Shift: snap to side center',
  '면 중앙 연결 유지 · 드래그: 연결할 면 변경': 'Keep side-center connection · Drag: choose a side',
  '화살표 머리 크기 조절': 'Resize arrowhead',
  'Shift: 90° · Alt: 정밀 회전 · Ctrl: 복제': 'Shift: 90° · Alt: precise rotation · Ctrl: duplicate',
  '도형에 연결 화살표 추가': 'Add connector arrow to shape',
  '연결 화살표': 'Connector arrow',
  '도형 연결 위치': 'Shape connection position',
  '도형 네 면 중앙에 연결': 'Connect to the center of a shape side',
  '도형 네 면 중앙 연결 켜짐 · 클릭하면 해제': 'Side-center connection on · Click to turn off',
  '도형 네 면 중앙 연결 꺼짐 · 클릭하면 켜기': 'Side-center connection off · Click to turn on',
  '연결선 모양': 'Connector path',
  '직선 끝단': 'Line caps',
  '● 둥근 끝단': '● Rounded ends',
  '■ 각진 끝단': '■ Square ends',
  'Shift: 수평·수직 맞춤': 'Shift: snap horizontally or vertically',
  '─ 직선': '─ Straight',
  '⌞ 2직선': '⌞ Two segments',
  '⌒ 곡선': '⌒ Curved',
  '┐ 계단식': '┐ Stepped',
  '화살표 끝 모양': 'Arrow end style',
  '— 없음': '— None',
  '● 채운 원': '● Filled circle',
  '○ 빈 원': '○ Open circle',
  '□ 네모': '□ Square',
  '▶ 채운 화살표': '▶ Filled arrow',
  '▷ 빈 화살표': '▷ Open arrow',
  '선택 항목 삭제': 'Delete selected item',
  '도형 텍스트 툴바': 'Shape text toolbar',
  '도형 텍스트 글꼴': 'Shape text font',
  '도형 텍스트 글꼴 선택': 'Choose shape text font',
  '도형 텍스트 크기 (휠로 조절 가능)': 'Shape text size (wheel adjustable)',
  '도형 텍스트 색 / 투명도': 'Shape text color / opacity',
  '도형 텍스트 굵게': 'Bold shape text',
  '도형 텍스트 가로 정렬': 'Shape text horizontal alignment',
  '도형 텍스트 세로 정렬': 'Shape text vertical alignment',
  '도형 텍스트 툴바 위치 고정': 'Pin shape text toolbar position',
  '선택 항목 삭제': 'Delete selected items',
  '머리': 'Head',
  '머리 크기': 'Head size',
  '도형 텍스트': 'Shape text',
  '△ 삼각형': '△ Triangle',
  '☆ 별': '☆ Star',
  '↗ 연결 화살표 추가': '↗ Add connector arrow',
  '원/타원': 'circle/ellipse',
  '직선': 'line',
  '화살표': 'arrow',
  '연결선': 'connected line',
  '점을 차례로 클릭해 연결선을 만들고 우클릭하여 닫으세요': 'Click points in order to draw a connected line, then right-click to close it.',
  '연결선은 한 페이지 안에서 완성하세요': 'Finish the connected line on the same page.',
  '닫힌 연결선은 모서리가 3개 이상 필요합니다': 'A closed connected line needs at least three vertices.',
  '연결선이 닫혔습니다 — 모서리점과 선분점을 끌어 수정할 수 있습니다': 'Connected line closed — drag its vertex and segment handles to adjust it.',
  '연결점 이동 · Shift: 수직 맞춤': 'Move vertex · Shift: align vertically',
  '선분 위치 이동': 'Move segment',
  '선분 위치 이동 · Shift: 수직 이동': 'Move segment · Shift: move vertically',
  '연결선 전체 크기 조절': 'Resize the entire connected line',
  '＋ 연결점 추가': '＋ Add connection point',
  '－ 연결점 삭제': '－ Delete connection point',
  '◇ 닫기 (시작점과 끝점 연결)': '◇ Close (connect the first and last points)',
  '이미지 형식으로 복제됨 — 대형 페이지는 브라우저 한도에 맞춰 해상도를 조정했습니다': 'Duplicated as images — large pages were resized to stay within browser limits.',
  'PDF 엔진 재시작 중...': 'Restarting the PDF engine…',
  'PDF 엔진(PDFium) 준비 중...': 'Preparing the PDF engine (PDFium)…',
  '분리할 문서가 없습니다': 'There are no documents to detach.',
  'PDF 원본 데이터를 찾을 수 없습니다': 'Could not find the original PDF data.',
  '원래 창에서 문서를 받지 못했습니다': 'Could not receive the document from the original window.',
  '이미지를 불러오지 못했습니다': 'Could not load the image.',
  '자른 이미지를 만들 수 없습니다': 'Could not create the cropped image.',
  '자른 이미지를 읽을 수 없습니다': 'Could not read the cropped image.',
  '작업 중 문서가 변경되어 결과를 적용하지 않았습니다': 'The document changed during processing, so the result was not applied.',
  '오브젝트를 찾지 못했습니다': 'Could not find the object.',
  '오브젝트 제거 실패': 'Could not remove the object.',
  '오브젝트 삽입 실패': 'Could not insert the object.',
  '페이지 로드 실패': 'Could not load the page.',
  '콘텐츠 재생성 실패': 'Could not rebuild the page content.',
  '원본 제거 실패': 'Could not remove the original object.',
  '텍스트 변경 실패': 'Could not change the text.',
  '전송할 문서 데이터를 찾을 수 없습니다': 'Could not find the document data to transfer.',
  '원래 편집기 창과 연결할 수 없습니다': 'Could not connect to the original editor window.',
  '⚠ PDF 엔진 오류 — 자동 재시작합니다': '⚠ PDF engine error — restarting automatically',
  '새 창 분리 실패:': 'Could not detach to a new window:',
  '새 창이 차단되었습니다 — 탭 우클릭 → 새 창에서 열기를 사용하세요': 'The new window was blocked — right-click the tab and choose Open in new window.',
  '새 창이 차단되었습니다 — 주소창의 팝업 허용을 확인하세요': 'The new window was blocked — allow pop-ups in the address bar.',
  '새 창 분리를 취소했습니다': 'New-window detachment cancelled.',
  '원래 편집기 창과 연결되어 있지 않습니다': 'This window is not connected to the original editor window.',
  '창 합치기 실패:': 'Could not merge the window:',
  'PDF 파일이 아닙니다': 'This is not a PDF file.',
  '🔒 편집 제한이 걸린 문서에는 추가할 수 없습니다 — 먼저 암호로 해제하세요': '🔒 You cannot add to an editing-restricted document — unlock it with the password first.',
  '이미 열려 있는 파일입니다:': 'This file is already open:',
  '✏️ 이 편집기로 저장한 파일 — 오브젝트를 이어서 편집할 수 있습니다': '✏️ Saved with this editor — you can continue editing its objects.',
  '🔒 편집 제한이 걸린 문서입니다 — 상단 [암호 입력]으로 해제하면 편집·저장할 수 있습니다': '🔒 This document restricts editing — use [Enter password] above to unlock editing and saving.',
  '✓ 편집 제한이 해제되었습니다 — 편집과 저장을 사용할 수 있습니다': '✓ Editing restrictions removed — editing and saving are now available.',
  '해제 실패:': 'Unlock failed:',
  '잘못된 링크입니다': 'This link is invalid.',
  '열 수 없는 링크입니다:': 'This link cannot be opened:',
  '링크 대상을 찾지 못했습니다': 'Could not find the link target.',
  '링크가 가리키는 페이지가 이 문서에 없습니다': 'The page referenced by this link is not in the document.',
  '링크를 따라가지 못했습니다': 'Could not follow the link.',
  '원본 오브젝트': 'Original object',
  '모든 페이지를 잘라낼 수 없습니다': 'You cannot cut every page.',
  '병합 완료 — 새 탭 (': 'Merge complete — new tab (',
  '모든 페이지를 삭제할 수는 없어 삭제는 생략했습니다': 'Deletion was skipped because every page cannot be deleted.',
  '전부 닫기 — 작업물을 임시 저장하지 않으며, 저장된 복구 데이터도 삭제했습니다': 'Closed all documents without temporarily saving the work, and deleted the saved recovery data.',
  '범위 복사 실패:': 'Copy area failed:',
  '이미지 형식 복제 실패:': 'Image-format duplication failed:',
  '썸네일 한 줄': 'Thumbnails per row:',
  '원본 인식 실패:': 'Original object recognition failed:',
  '원본': 'Original',
  '원본 복제 실패:': 'Original object duplication failed:',
  '텍스트 수정 실패:': 'Text editing failed:',
  '세션 복구 완료 (': 'Session restored (',
  '⚠ 오류:': '⚠ Error:',
  'PDF 편집': 'Edit PDF',
  '잠금 해제': 'Unlock',
  '파일 열기': 'Open file',
  '열기': 'Open',
  '저장': 'Save',
  '인쇄': 'Print',
  '실행 취소': 'Undo',
  '다시 실행': 'Redo',
  '빈페이지 추가': 'Add blank page',
  '빈 페이지': 'Blank page',
  'PDF 병합': 'Merge PDF',
  '병합': 'Merge',
  '왼쪽 회전': 'Rotate left',
  '오른쪽 회전': 'Rotate right',
  '텍스트 추가': 'Add text',
  '텍스트': 'Text',
  '도형 삽입': 'Insert shape',
  '도형': 'Shape',
  '편집 모드': 'Edit mode',
  '편집': 'Edit',
  '범위복사': 'Copy area',
  '검색': 'Search',
  '설정': 'Settings',
  '파일 없음': 'No file',
  '연속': 'Continuous',
  '1장': 'Single',
  '2장': 'Two-page',
  '이전 페이지': 'Previous page',
  '다음 페이지': 'Next page',
  '페이지 번호 입력 후 Enter': 'Enter a page number and press Enter',
  '확대·축소 배율': 'Zoom level',
  '폭맞춤': 'Fit width',
  '폭 맞춤': 'Fit width',
  '100%로 보기': 'Actual size (100%)',
  '처리 중...': 'Processing…',
  '취소': 'Cancel',
  '확인': 'OK',
  '닫기': 'Close',
  '적용': 'Apply',
  '삭제': 'Delete',
  '복사': 'Copy',
  '범위 선택 취소': 'Cancel area selection',
  '범위 복사 툴바': 'Copy area toolbar',
  '잘라내기': 'Cut',
  '붙여넣기': 'Paste',
  '선택 페이지 인쇄': 'Print selected pages',
  '페이지 크기 변경': 'Resize pages',
  '페이지 자르기': 'Crop pages',
  '이미지 자르기': 'Crop image',
  '자르기 적용': 'Apply crop',
  '이미지 형식으로 복제': 'Duplicate as image',
  '왼쪽으로 회전': 'Rotate left',
  '오른쪽으로 회전': 'Rotate right',
  '앞으로': 'Bring forward',
  '뒤로': 'Send backward',
  '맨 앞으로': 'Bring to front',
  '맨 뒤로': 'Send to back',
  '일반': 'General',
  '모바일': 'Mobile',
  '단축키': 'Shortcuts',
  '라이선스': 'Licenses',
  '초기화': 'Reset',
  '파일 순서': 'File order',
  '맨 앞': 'First',
  '이전': 'Previous',
  '다음': 'Next',
  '맨 뒤': 'Last',
  '용지 크기': 'Paper size',
  '방향': 'Orientation',
  '세로': 'Portrait',
  '가로': 'Landscape',
  'PDF 구조 유지': 'Preserve PDF structure',
  '이미지 PDF': 'Image PDF',
  '높은 품질': 'High quality',
  '균형': 'Balanced',
  '작은 용량': 'Smaller file',
  '암호': 'Password',
  'PDF 암호': 'PDF password',
  '잠금 설정': 'Lock PDF',
  '열람 잠금': 'Open password',
  '편집 잠금': 'Editing restrictions',
  '열람 암호': 'Open password',
  '관리자 암호': 'Administrator password',
  '편집기': 'Editor',
  '변환 방향': 'Conversion direction',
  '높음': 'High',
  '작게': 'Smaller',
  'PDF로 변환': 'Convert to PDF',
  '전체 페이지': 'All pages',
  '선택 페이지': 'Selected pages',
  '전체': 'All',
  '선택': 'Selected',
  '선택 해제': 'Deselect',
  '파일 추가': 'Add files',
  '다운로드': 'Download',
  '자동 저장': 'Auto-save',
  '완료': 'Done',
  '오류': 'Error',
  '경고': 'Warning',
  '열린 문서 목록': 'Open documents',
  '드래그하여 패널 폭 조절': 'Drag to resize the panel',
  '썸네일 패널 표시/숨김 (F4)': 'Show/hide thumbnail panel (F4)',
  '연속 스크롤 보기': 'Continuous scrolling',
  '한 장 보기 — 드래그/스크롤로 페이지 이동': 'Single-page view — drag or scroll to move pages',
  '두 장 보기': 'Two-page view',
  '축소 (Ctrl+휠)': 'Zoom out (Ctrl+wheel)',
  '확대 (Ctrl+휠)': 'Zoom in (Ctrl+wheel)',
  'DaydayPDF 홈': 'DaydayPDF home',
  '경고 닫기': 'Close warning',
  '암호 입력': 'Enter password',
  '자르기': 'Crop',
  '최근 선택': 'Recent selection',
  '직접 선택…': 'Custom selection…',
  '자르기 해제': 'Reset crop',
  '▭ 사각형': '▭ Rectangle',
  '◯ 원/타원': '◯ Circle/Ellipse',
  '╱ 직선': '╱ Line',
  '➔ 화살표': '➔ Arrow',
  '⌁ 연결선': '⌁ Connected line',
  '⟳ 90° 회전': '⟳ Rotate 90°',
  '새 탭으로 병합': 'Merge into a new tab',
  '↗ 새 창에서 열기': '↗ Open in new window',
  '↙ 원래 창으로 합치기': '↙ Merge back into original window',
  '✕ 닫기': '✕ Close',
  '다른 탭 모두 닫기': 'Close other tabs',
  '왼쪽 탭 모두 닫기': 'Close tabs to the left',
  '오른쪽 탭 모두 닫기': 'Close tabs to the right',
  '전부 닫기': 'Close all',
  '일반 설정': 'General settings',
  '테마': 'Theme',
  '다크': 'Dark',
  '글래스 효과': 'Glass effect',
  '현재 테마에 반투명·블러 효과 적용': 'Add transparency and blur to the current theme',
  '라이트': 'Light',
  '브라우저 설정': 'Browser settings',
  '이미지 품질': 'Image quality',
  '복제·내보내기': 'Duplicate · Export',
  '낮음 — 용량 작음 (JPG)': 'Low — smaller file (JPG)',
  '보통 (JPG, 144 DPI)': 'Standard (JPG, 144 DPI)',
  '높음 (JPG)': 'High (JPG)',
  '매우 높음 (PNG, 216 DPI)': 'Very high (PNG, 216 DPI)',
  '원본 근접 (PNG, 300 DPI)': 'Near original (PNG, 300 DPI)',
  '최고 (PNG, 432 DPI·용량 큼)': 'Maximum (PNG, 432 DPI · large file)',
  '종료 후 다시 열기': 'Reopen after closing',
  '이어서 작업': 'Continue where you left off',
  '전부 닫기 — 임시 저장 안 함 · 다음 실행은 빈 화면': 'Close all — do not temporarily save · start empty next time',
  '확인 중…': 'Checking…',
  '지금 삭제': 'Delete now',
  '글꼴 캐시': 'Font cache',
  '선택한 글꼴은 문서에서 실제 사용한 글자만 이 기기에 누적 보관해 빠르게 불러옵니다.': 'For selected fonts, only the characters actually used in the document are accumulated on this device for faster loading.',
  '목록의 글꼴 이름은 작은 미리보기로만 받고, 실행 중 메모리는 앱을 닫으면 해제됩니다.': 'Font names in the list use small previews, and in-memory fonts are released when the app closes.',
  '캐시 삭제': 'Clear cache',
  '글꼴을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.': 'Could not load the font. Check your internet connection.',
  '글꼴 캐시를 삭제했습니다': 'Font cache deleted',
  '글꼴 캐시를 삭제하지 못했습니다': 'Could not delete font cache',
  '모바일 설정': 'Mobile settings',
  '오브젝트 조절': 'Object controls',
  '크기 조절 핸들': 'Resize handles',
  '썸네일 패널': 'Thumbnail panel',
  '썸네일 1열': 'One thumbnail column',
  '썸네일 2열': 'Two thumbnail columns',
  '썸네일 3열': 'Three thumbnail columns',
  '탭 닫기': 'Close tab',
  '타원 그리기': 'Draw ellipse',
  '사각형 그리기': 'Draw rectangle',
  '다중 선택': 'Multiple selection',
  '오픈 소스 및 라이선스': 'Open source and licenses',
  '라이선스 원문': 'License text',
  '프로젝트': 'Project',
  '전체 고지 새 창에서 보기': 'View all notices in a new window',
  '텍스트 파일 다운로드': 'Download text file',
  '단축키 기본값': 'Default shortcuts',
  '문서 닫기': 'Close document',
  '변경 사항을 저장하시겠습니까?': 'Do you want to save your changes?',
  '저장하지 않고 닫으면 임시 인쇄 파일이 삭제됩니다.': 'Closing without saving deletes the temporary print file.',
  '저장 안 함 (N)': "Don't save (N)",
  '취소 (X / Esc)': 'Cancel (X / Esc)',
  '뒤로가기': 'Go back',
  '범위': 'Range',
  '직접 입력': 'Custom',
  '자동 (원본 유지)': 'Auto (keep original)',
  '방식': 'Method',
  'PDF (선명, 권장)': 'PDF (sharp, recommended)',
  '이미지 (호환용)': 'Image (compatibility)',
  '미리보기': 'Preview',
  '용지': 'Paper',
  '직접 입력 (mm)': 'Custom (mm)',
  '크기(mm)': 'Size (mm)',
  '자동 (내용 방향에 맞춤)': 'Auto (match content orientation)',
  '원본 크기로': 'Original size',
  '어떻게 열까요?': 'How would you like to open them?',
  '각각 탭으로': 'Separate tabs',
  '하나로 합치기': 'Merge into one',
  '각각 탭으로 열기': 'Open in separate tabs',
  '📤 페이지 내보내기': '📤 Export pages',
  '형식': 'Format',
  '이미지': 'Image',
  '내보낸 후 원본에서 해당 페이지 삭제': 'Delete exported pages from the original',
  '내보내기': 'Export',
  '복사 (Ctrl+C)': 'Copy (Ctrl+C)',
  '잘라내기 (Ctrl+X)': 'Cut (Ctrl+X)',
  '붙여넣기 (Ctrl+V)': 'Paste (Ctrl+V)',
  '삭제 (Delete)': 'Delete',
  '⟲ 왼쪽으로 회전': '⟲ Rotate left',
  '⟳ 오른쪽으로 회전': '⟳ Rotate right',
  '내보내기…': 'Export…',
  '스포카 한 산스': 'Spoqa Han Sans',
  '나눔고딕': 'Nanum Gothic',
  '나눔명조': 'Nanum Myeongjo',
  '나눔손글씨 펜': 'Nanum Pen Script',
  '은 열어 둔 PDF를 이 컴퓨터에 임시 저장해 두고 다음 실행 때 묻지 않고 모두 다시 엽니다.': 'temporarily saves open PDFs on this computer and reopens all of them automatically next time.',
  '는': '',
  '· 문서/썸네일/미리보기 확대·축소:': '· Zoom document/thumbnails/preview:',
  'Ctrl+휠': 'Ctrl+wheel',
  'Space+드래그': 'Space+drag',
  '전체선택,': 'Select all,',
  '· 탭:': '· Tabs:',
  '원본 PDF 편집 엔진 · 래퍼 MIT, PDFium 및 관련 구성요소는 Apache-2.0·BSD 계열 등 각 고지 적용 ·': 'Original PDF editing engine · MIT-licensed wrapper; PDFium and related components use Apache-2.0, BSD-family, and other applicable notices ·',
  '개': 'items',
  '순서변경': 'Reorder',
  '작은 용량': 'Smaller file',
  '처리 중…': 'Processing…',
  '개별 선택': 'Individual selection',
  '회전': 'Rotate',
  '인식 언어': 'Recognition language',
  '한국어 + 영어': 'Korean + English',
  '한국어': 'Korean',
  '한글 문서': 'Korean documents',
  '영어': 'English',
  '검색 가능한 PDF': 'Searchable PDF',
  'Word 문서': 'Word document',
  '인식 품질': 'Recognition quality',
  '정밀': 'High accuracy',
  '빠르게': 'Fast',
  '텍스트가 있는 페이지도 다시 인식': 'Run OCR again on pages that already contain text',
  '베타 — 자주 업데이트됩니다': 'Beta — updated frequently',
  '확대·축소 배율 입력': 'Enter zoom level',
  '글꼴': 'Font',
  '글꼴 선택': 'Choose font',
  '글꼴 검색': 'Search fonts',
  '글꼴 분류': 'Font category',
  '글꼴 105개 검색': 'Search 105 fonts',
  '전체 스타일': 'All styles',
  '한글': 'Korean',
  '★ 즐겨찾기 · 최근 사용 우선': '★ Favorites · recent fonts first',
  '글자 크기 (휠로 조절 가능)': 'Font size (mouse wheel supported)',
  '글자 색 / 투명도': 'Text color / opacity',
  '굵게': 'Bold',
  '굵게 (Ctrl+B)': 'Bold (Ctrl+B)',
  '도형 텍스트 굵게 (Ctrl+B)': 'Bold shape text (Ctrl+B)',
  '가로 정렬': 'Horizontal alignment',
  '세로 정렬 (텍스트 영역 높이를 늘렸을 때)': 'Vertical alignment (when the text box is taller)',
  '선 표시 / 색 / 투명도': 'Stroke visibility / color / opacity',
  '선 표시': 'Show stroke',
  '테두리 두께 (0.1–40px)': 'Stroke width (0.1–40px)',
  '배경 표시 / 색 / 투명도': 'Fill visibility / color / opacity',
  '배경 표시': 'Show fill',
  '이미지 내부 영역 자르기': 'Crop inside the image',
  '툴바 위치 고정': 'Pin toolbar position',
  '끌어서 이동': 'Drag to move',
  'Alt+드래그': 'Alt+drag',
  'Alt+방향키': 'Alt+arrow keys',
  '오브젝트 정밀 이동 (1/10 속도)': 'Move objects precisely (1/10 speed)',
  '🎨 직접 선택 닫기': '🎨 Close custom color picker',
  '자르기 미리보기 확대/축소': 'Zoom crop preview',
  '— 창 모서리를 끌면 크기 조절': '— drag a window corner to resize',
  '문서에서 검색...': 'Search this document…',
  '이전 (Shift+Enter)': 'Previous (Shift+Enter)',
  '다음 (Enter)': 'Next (Enter)',
  '닫기 (Esc)': 'Close (Esc)',
  '음영': 'Shading',
  '폼': 'Form',
  '오브젝트': 'Object',
  '주석': 'Annotation',
  '메모': 'Note',
  '텍스트 주석': 'Text annotation',
  '선': 'Line',
  '사각형': 'Rectangle',
  '원': 'Circle',
  '다각형': 'Polygon',
  '폴리라인': 'Polyline',
  '형광펜': 'Highlight',
  '밑줄': 'Underline',
  '물결 밑줄': 'Squiggly underline',
  '취소선': 'Strikethrough',
  '스탬프': 'Stamp',
  '잉크': 'Ink',
  '기타': 'Other',
  '복사할 범위를 드래그하세요 (Esc 취소)': 'Drag to select the area to copy (Esc to cancel)',
  '범위를 조절한 뒤 [복사]를 누르세요': 'Adjust the area, then select [Copy]',
  '붙여넣을 위치를 클릭하세요 (Esc 취소)': 'Click where you want to paste (Esc to cancel)',
  '텍스트로 복사됨 — Ctrl+V로 붙여넣으면 바로 편집할 수 있습니다': 'Copied as editable text — press Ctrl+V to paste and edit it',
  '영역 안에 오브젝트가 없습니다': 'No objects are inside the selection.',
  '영역 안에 원본 오브젝트가 없습니다': 'No original PDF objects are inside the selection.',
  '페이지 번호를 입력하세요': 'Enter a page number.',
  '모든 페이지를 삭제할 수 없습니다': 'You cannot delete every page.',
  '고정 버튼 위치를 기준으로 툴바 고정됨 — 다시 누르면 해제': 'Toolbar pinned here — select the pin again to release it.',
  '주석은 순서 변경을 지원하지 않습니다': 'Reordering annotations is not supported.',
  '주석은 회전을 지원하지 않습니다': 'Rotating annotations is not supported.',
  '편집 제한 문서는 이미지 방식으로만 인쇄할 수 있습니다': 'Restricted PDFs can only be printed as images.',
  '인쇄창을 열지 못했습니다. 다시 시도하세요': 'Could not open the print dialog. Please try again.',
  '클립보드가 비어 있습니다 (Ctrl+C로 페이지 복사)': 'The clipboard is empty (copy pages with Ctrl+C).',
  '오브젝트 복사 준비 중...': 'Preparing object copy…',
  '오브젝트 잘라내기 준비 중...': 'Preparing object cut…',
  '페이지 복사 준비 중...': 'Preparing page copy…',
  '페이지 잘라내기 준비 중...': 'Preparing page cut…',
  '오브젝트 붙여넣는 중...': 'Pasting object…',
  '페이지 붙여넣는 중...': 'Pasting pages…',
  '클립보드 붙여넣는 중...': 'Pasting clipboard data…',
  '다른 웹 창의 페이지 클립보드를 찾지 못했습니다': 'Could not find page clipboard data from another web window.',
  '다른 웹 창의 오브젝트 클립보드를 찾지 못했습니다': 'Could not find object clipboard data from another web window.',
  '붙여넣을 오브젝트 데이터가 없습니다': 'There is no object data to paste.',
  '복사할 PDF 원본을 찾을 수 없습니다': 'Could not find the source PDF to copy.',
  '복사 페이지 원본 매핑이 없습니다': 'The copied page source mapping is missing.',
  '복사 오브젝트 원본 매핑이 없습니다': 'The copied object source mapping is missing.',
  '페이지': 'Page',
  '오브젝트 붙여넣기 실패:': 'Object paste failed:',
  '페이지 붙여넣기 실패:': 'Page paste failed:',
  '붙여넣기 실패:': 'Paste failed:',
  '병합할 PDF를 추가하세요': 'Add PDFs to merge.',
  '두 개 이상이어야 병합할 수 있습니다': 'Add at least two PDFs to merge.',
  '원본 크기로 되돌림': 'Restored the original page size.',
  '크기를 올바르게 입력하세요 (mm)': 'Enter a valid size in millimeters.',
  '자를 수 있는 페이지가 없습니다 (빈 페이지 제외)': 'There are no pages that can be cropped (blank pages are excluded).',
  '미리보기 실패': 'Could not create the preview.',
  '자르기 해제됨': 'Crop reset.',
  '전체 영역이 선택되어 자르지 않았습니다': 'Nothing was cropped because the entire page was selected.',
  '자를 이미지 오브젝트를 선택하세요': 'Select an image object to crop.',
  '선택한 이미지를 찾을 수 없습니다': 'Could not find the selected image.',
  '이미지 크기를 확인할 수 없습니다': 'Could not determine the image size.',
  '문서 상태가 변경되어 자르기를 취소했습니다': 'Cropping was cancelled because the document changed.',
  '전체 이미지가 선택되어 변경하지 않았습니다': 'Nothing was changed because the entire image was selected.',
  '이미지 처리 기능을 사용할 수 없습니다': 'Image processing is unavailable.',
  '페이지 표시 상태가 변경되어 자르기를 취소했습니다': 'Cropping was cancelled because the page view changed.',
  '이미지 자르기 적용됨 (Ctrl+Z로 복구 가능)': 'Image crop applied (press Ctrl+Z to restore).',
  '복구 데이터를 삭제했습니다': 'Recovery data deleted.',
  '다음 실행 때 열려 있는 PDF를 모두 자동으로 엽니다': 'All open PDFs will reopen automatically next time.',
  '⚠ 표시된 중복 단축키를 먼저 변경하세요': '⚠ Resolve the highlighted shortcut conflicts first.',
  '원하는 위치를 클릭해 텍스트를 추가하세요 (한 번 추가 후 자동 해제)': 'Click where you want to add text (the tool turns off after one insertion).',
  '빈 페이지에는 원본 오브젝트가 없습니다': 'Blank pages have no original PDF objects.',
  '주석 내용 수정은 지원하지 않습니다 — 이동·크기·색·삭제만 가능': 'Annotation text editing is not supported — you can move, resize, recolor, or delete it.',
  '텍스트 오브젝트만 내용을 수정할 수 있습니다': 'Only text objects can have their contents edited.',
  'PDFium 엔진 로드 실패 — 인터넷 연결을 확인하세요': 'Could not load the PDFium engine — check your internet connection.',
}));

for (const [ko, en] of Object.entries({
  "본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.": "This product was developed with reference to Hancom’s public HWP document file (.hwp) specification.",
  "다른 도구": "Other tools",
})) { if (!EXACT.has(ko)) EXACT.set(ko, en); }

const FRAGMENTS = Object.entries({
  'PDF 파일을 끌어다 놓거나 [열기]를 누르세요': 'Drop a PDF here or select [Open]',
  '여러 파일을 한 번에 끌어놓으면 각각 탭으로 열립니다': 'Dropping multiple files opens each one in a separate tab',
  '현재 문서 끝에 추가': 'append to the current document',
  '보기 · 병합 · 분할/추출 · 삭제 · 회전 · 순서변경 · 크기변경 · 텍스트': 'View · Merge · Split/extract · Delete · Rotate · Reorder · Resize · Text',
  '편집 제한이 있는 파일입니다. 암호를 입력하세요.': 'This file has editing restrictions. Enter its password.',
  '해제 전에는 편집·저장을 사용할 수 없습니다': 'Editing and saving are unavailable until it is unlocked',
  '자주 업데이트됩니다': 'Updated frequently',
  '범위 복사': 'Copy area',
  '드래그한 영역을 이미지로 복사': 'Copy the dragged area as an image',
  '파일을 불러온 뒤 목록을 끌어서 합칠 순서를 바꿀 수 있습니다.': 'After adding files, drag the list to set the merge order.',
  '선택한 페이지와 선택하지 않은 페이지를 한 번에 두 PDF로 나눕니다.': 'Splits selected and unselected pages into two PDFs at once.',
  'Shift로 범위를, Ctrl로 개별 페이지를 함께 선택한 뒤 썸네일을 끌어 한 번에 이동할 수 있습니다.': 'Use Shift for a range or Ctrl for individual pages, then drag the thumbnails together.',
  '선택한 페이지의 내용은 비율을 유지한 채 새 용지 가운데에 맞춰집니다.': 'Selected page content keeps its proportions and is centered on the new paper size.',
  'PDF 구조를 유지하면서 안전하게 확인된 일반 RGB·회색 이미지만 다시 압축합니다.': 'Keeps the PDF structure and recompresses only verified standard RGB and grayscale images.',
  '텍스트·벡터·링크는 유지하고 이미지의 해상도와 JPEG 품질을 적극적으로 최적화합니다.': 'Keeps text, vectors, and links while optimizing image resolution and JPEG quality.',
  '투명도·이미지 마스크·특수 색공간은 압축 대상에서 제외합니다.': 'Transparency, image masks, and special color spaces are excluded from compression.',
  '압축 전후 화면이 크게 달라지면 결과를 폐기하고 원본을 자동 저장합니다.': 'If visual validation detects a major change, the result is discarded and the original is saved automatically.',
  '전자서명 PDF는 다시 저장하면 서명이 무효화될 수 있습니다.': 'Saving a digitally signed PDF again may invalidate its signature.',
  '처리가 끝나면 새 PDF가 자동 저장됩니다.': 'The new PDF is saved automatically when processing finishes.',
  '소유하거나 사용 권한이 있는 PDF에만 사용하세요.': 'Use this only with PDFs you own or are authorized to access.',
  '전체 편집기의 기능과 저장·복구 호환성을 그대로 사용합니다.': 'Uses the full editor with the same save and recovery compatibility.',
  '파일을 별도 서버에 업로드하지 않고 이 브라우저에서 실행합니다.': 'Runs in this browser without uploading the file to a separate server.',
  '여러 PDF를 추가하고 파일 순서를 정해 하나로 저장합니다.': 'Add multiple PDFs, arrange their order, and save them as one file.',
  '썸네일에서 페이지를 골라 선택·선택 안 함 두 PDF로 분리합니다.': 'Choose pages in the thumbnail view and split them into selected and unselected PDFs.',
  '변환 방향과 파일을 고른 뒤 썸네일에서 변환할 페이지만 선택합니다.': 'Choose a direction and file, then select the pages to convert in the thumbnail view.',
  'PDF 구조를 유지하거나 모든 페이지를 이미지 PDF로 바꿔 용량을 줄입니다.': 'Reduce file size while preserving the PDF structure or converting every page to an image PDF.',
  'Shift·Ctrl로 여러 썸네일을 선택해 함께 끌거나 이동 버튼으로 순서를 바꿉니다.': 'Select multiple thumbnails with Shift or Ctrl, then drag them together or use the move buttons.',
  '썸네일에서 여러 페이지를 선택하고 좌우로 회전합니다.': 'Select multiple pages in the thumbnail view and rotate them left or right.',
  '선택한 페이지의 내용을 비율 유지·가운데 정렬로 배치하고 원하는 용지 규격으로 저장합니다.': 'Keep page proportions, center the content, and save using the selected paper size.',
  '소유하거나 사용 권한이 있는 PDF의 암호를 입력해 해제 사본을 만듭니다.': 'Enter the password for a PDF you own or may access and save an unlocked copy.',
  'PDF에 열람·편집 잠금을 설정하거나 권한이 있는 문서의 잠금을 해제한 사본을 만듭니다.': 'Add open and editing security, or save an unlocked copy of a document you are authorized to process.',
  '파일을 선택하거나 끌어다 놓으세요': 'Choose a file or drag it here',
  'PDF 여러 개를 선택하거나 끌어다 놓으세요': 'Choose multiple PDFs or drag them here',
  '나눌 PDF 한 개를 선택하거나 끌어다 놓으세요': 'Choose one PDF to split or drag it here',
  '선택한 변환 방식에 맞는 파일을 끌어다 놓으세요': 'Drag a file that matches the selected conversion',
  '용량을 줄일 PDF 한 개를 선택하거나 끌어다 놓으세요': 'Choose one PDF to compress or drag it here',
  '순서를 바꿀 PDF 한 개를 선택하거나 끌어다 놓으세요': 'Choose one PDF to reorder or drag it here',
  '회전할 PDF 한 개를 선택하거나 끌어다 놓으세요': 'Choose one PDF to rotate or drag it here',
  '크기를 바꿀 PDF 한 개를 선택하거나 끌어다 놓으세요': 'Choose one PDF to resize or drag it here',
  '잠금을 해제할 PDF 한 개를 선택하거나 끌어다 놓으세요': 'Choose one PDF to unlock or drag it here',
  '잠금을 설정하거나 해제할 PDF 한 개를 선택하거나 끌어다 놓으세요': 'Choose one PDF to lock or unlock, or drag it here',
  '이용이 만족스러우셨다면 주변 여러 곳에도 소개해 주세요': 'If DaydayPDF helped, please share it with others',
  '전체 선택': 'Select all',
  '범위 선택': 'Range selection',
  '썸네일 크기': 'Thumbnail size',
  '썸네일을 끌어 순서 변경': 'Drag thumbnails to reorder',
  '읽는 중': 'Reading',
  '불러오는 중': 'Loading',
  '변환 중': 'Converting',
  '압축 중': 'Compressing',
  '저장 중': 'Saving',
  '렌더링 중': 'Rendering',
  '페이지 준비 중': 'Preparing pages',
  '파일 준비 중': 'Preparing file',
  '안전성 확인 중': 'Validating output',
  '원본 유지': 'Original preserved',
  '선택됨': 'selected',
  '선택 안 함': 'unselected',
  '개 파일': ' files',
  '개 변환 항목': ' conversion items',
  '개 선택': ' selected',
  '개 문서': ' documents',
  '개 페이지': ' pages',
  '저장되었습니다': 'saved',
  '완료되었습니다': 'completed',
  '실패했습니다': 'failed',
  '지원하지 않는': 'Unsupported',
  '올바르지 않은': 'Invalid',
  '암호가 필요합니다': 'A password is required',
  '암호가 올바르지 않습니다': 'The password is incorrect',
  '메모리가 부족합니다': 'Not enough memory',
  '다시 시도해 주세요': 'Please try again',
  'Ctrl+W · Ctrl+T · Ctrl+N · F11처럼 브라우저 권한이 더 강한 조합은 사용할 수 없습니다.': 'Ctrl+W, Ctrl+T, Ctrl+N, F11, and other browser-reserved shortcuts cannot be used.',
  '창 모서리를 끌면 크기 조절': 'drag a window corner to resize',
  '영역/모서리 = 이동/크기': 'area/corner = move/resize',
  '화면 이동': 'pan view',
  '방향키 = 페이지 보기': 'arrow keys = browse pages',
  '이미지 오브젝트 내부 영역': 'area inside the image object',
  '영역 드래그 = 이동': 'drag area = move',
  '모서리 = 크기 조절': 'corner = resize',
  '적용 후에도 Ctrl+Z로 복구 가능': 'Ctrl+Z can restore it after applying',
  '행을 끌어 순서 변경': 'drag rows to reorder',
  '여기에 PDF 파일을 끌어다 놓거나 [파일 추가]를 누르세요': 'Drop PDF files here or select [Add files]',
  '원본 파일 미지정 — 저장 시 위치 선택': 'No original file — choose a location when saving',
  '원본 파일': 'Original file',
  '개별 선택': 'individual selection',
  '작업물을 임시 저장하지 않습니다': 'does not temporarily save your work',
  '저장하지 않은 편집 내용은': 'Unsaved edits',
  '종료와 함께 사라지고, 다음 실행은 빈 화면으로 시작합니다': 'are discarded when you close the app, and the next session starts empty',
  '서버로는 전송되지 않음': 'not sent to a server',
  '앱 종료 후': 'After closing the app',
  '이어서 작업 — 임시 저장 후 다음 실행 때 모두 자동으로 열기': 'Continue — temporarily save and reopen everything automatically next time',
  '핸들을 한 번 눌러 활성화한 뒤 드래그합니다.': 'Tap a handle once to activate it, then drag.',
  '같은 핸들이나 다른 곳을 누르면 해제되며, 대각선 핸들은 가로세로 비율을 유지합니다.': 'Tap the same handle or elsewhere to deactivate it; diagonal handles preserve the aspect ratio.',
  '앞으로 추가되는 모바일 전용 설정은 이 탭에서 관리할 수 있습니다.': 'Future mobile-only settings will appear on this tab.',
  '칸을 클릭한 뒤 원하는 키를 누르세요.': 'Select a field, then press the desired key.',
  '브라우저 권한이 더 강한 조합은 사용할 수 없습니다.': 'Shortcuts reserved by the browser cannot be used.',
  '문서/썸네일/미리보기': 'document/thumbnails/preview',
  '자유 이동': 'Pan freely',
  '복사·잘라내기·붙여넣기': 'Copy · Cut · Paste',
  '휠클릭': 'middle-click',
  '닫기, 우클릭 메뉴': 'close, context menu',
  '썸네일 우클릭': 'thumbnail context menu',
  '편집 메뉴': 'edit menu',
  '에서 사용하는 주요 구성요소입니다.': 'uses the following main components.',
  '라이선스 원문은 새 창': 'The license text opens in a new window',
  '브라우저 설정에 따라 새 탭': 'or a new tab, depending on browser settings',
  '에서 열립니다.': '.',
  'PDF 표시·텍스트 추출 엔진': 'PDF rendering and text extraction engine',
  'PDF 생성·저장': 'PDF creation and saving',
  'PDF 글꼴 임베딩': 'PDF font embedding',
  '패키지 및 라이선스': 'Package and license',
  '원본 PDF 편집 엔진': 'Original PDF editing engine',
  '관련 구성요소는': 'related components use',
  '각 고지 적용': 'their respective notices',
  '화면 아이콘': 'UI icons',
  '프로젝트 소유자가 보유한': 'covered by the project owner’s',
  '상용 라이선스 적용': 'commercial license',
  '내용은 비율을 유지한 채 가운데 정렬로 맞춰집니다.': 'Content keeps its proportions and is centered.',
  '파일마다 탭을 만들어 따로 편집': 'create a tab for each file',
  '순서를 확인한 뒤 한 문서로 병합': 'check the order, then merge into one document',
  '최대': 'Up to',
  '추천': 'Recommended',
  '원본 방향 유지': 'keep original orientation',
  'PDF는 한 개만 처리하므로 첫 번째 파일만 열었습니다.': 'Only one PDF can be processed, so the first file was opened.',
  '압축 대상 이미지 없음': 'no compressible images',
  '이미지 PDF': 'image PDF',
  '이미지 ': 'image ',
  '개 최적화': ' optimized',
  '페이지 이미지 PDF': '-page image PDF',
  '목록에서 삭제': 'Remove from list',
  '페이지 PDF 저장을 시작했습니다.': '-page PDF download started.',
  '페이지 PDF를 확인했습니다.': '-page PDF loaded.',
  '페이지를 확인했습니다.': ' pages loaded.',
  '페이지 · 원본': ' pages · Original',
  '페이지 ·': ' pages ·',
  '페이지 차이': ' page differs',
  '페이지 크기로 변경하는 중': ' paper size',
  '용지 크기를 선택했습니다.': ' paper size selected.',
  '품질을 선택했습니다.': ' quality selected.',
  '품질로 처리 후 자동 저장합니다.': ' quality, then save automatically.',
  '개 변환 항목을 확인했습니다.': ' conversion items loaded.',
  '변환할 항목을 선택하세요.': 'Select the items to convert.',
  '페이지 PDF 2개 저장을 시작했습니다.': '-page PDFs download started.',
  '크기로 변경한 PDF 저장을 시작했습니다.': ' size PDF download started.',
  'ZIP 저장을 시작했습니다.': ' ZIP download started.',
  '장 PDF 저장을 시작했습니다.': '-image PDF download started.',
  '총 ': 'Total ',
  '개 PDF를 확인했습니다.': ' PDFs loaded.',
  '파일 순서를 정한 뒤 저장하세요.': 'Arrange the files, then save.',
  '용량 줄이기 완료': 'Compression complete',
  '자동 저장을 시작했습니다.': 'Automatic download started.',
  '감소': 'smaller',
  '증가': 'larger',
  '추가 감소 없음': 'no further reduction',
  '원본 ': 'Original ',
  '변환 엔진은 아직 연결되지 않았습니다.': 'conversion engine is not connected yet.',
  '선택 안 한': 'Unselected',
  '비선택': 'Unselected',
  '편집기 ': 'Editor ',
  '선택 ': 'Selected ',
  'PDF 구조 유지': 'Preserve PDF structure',
  '균형': 'Balanced',
  '높은 품질': 'High quality',
  '작은 용량': 'Smaller file',
  '저장할 파일 이름을 입력하세요': 'Enter a file name',
  '안전 사본으로 저장': 'Save a safe copy',
  '안전하게 저장': 'Save safe copy',
  '문서에 저장하지 않은 편집 내용이 있습니다.': 'This document has unsaved edits.',
  '닫으시겠습니까?': 'Do you want to close it?',
  '암호가 걸린 PDF입니다.': 'This PDF is password-protected.',
  '열람 암호를 입력하세요.': 'Enter the open password.',
  '열기 실패': 'Open failed',
  '저장 실패': 'Save failed',
  '인쇄 실패': 'Print failed',
  '내보내기 실패': 'Export failed',
  '복구 실패': 'Recovery failed',
  '삭제 실패': 'Delete failed',
  '복사 실패': 'Copy failed',
  '확인 실패': 'Validation failed',
  '알 수 없는 오류': 'Unknown error',
  '암호 입력을 취소했습니다': 'Password entry cancelled',
  '파일이 저장되지 않았을 수 있으니 다시 시도하세요.': 'The file may not have been saved. Please try again.',
  '페이지를 썸네일에서 선택하세요': 'Select pages in the thumbnail view',
  '내보낼 페이지를 썸네일에서 선택하세요': 'Select pages to export in the thumbnail view',
  '삭제할 페이지를 썸네일에서 선택하세요': 'Select pages to delete in the thumbnail view',
  '크기를 변경할 페이지를 선택하세요': 'Select pages to resize',
  '인쇄 범위를 확인하세요': 'Check the print range',
  '처리 중': 'Processing',
  '미리보기 생성 중': 'Creating preview',
  '미리보기 준비 중': 'Preparing preview',
  '인쇄 준비 중': 'Preparing print output',
  '프린터로 보내는 중': 'Sending to printer',
  '편집 제한 해제 중': 'Removing editing restrictions',
  '이미지 형식으로 내보내는 중': 'Exporting as an image',
  '이미지 형식으로 복제 중': 'Duplicating as an image',
  '이전 작업 여는 중': 'Opening previous work',
  '저장 완료': 'Save complete',
  '저장됨': 'Saved',
  '삭제됨': 'Deleted',
  '설정 저장됨': 'Settings saved',
  '단축키 저장됨': 'Shortcuts saved',
  '팝업이 차단되었습니다': 'The pop-up was blocked',
  '허용 후 다시 시도하세요': 'Allow pop-ups and try again',
}).sort((a, b) => b[0].length - a[0].length);

const DYNAMIC_RULES = [
  [/^(\d+)페이지 PDF를 확인했습니다\. 인식 설정을 확인하고 저장하세요\.$/, match => `${match[1]}-page PDF loaded. Review recognition settings and save.`],
  [/^🔒 "(.+)"\n암호가 걸린 PDF입니다\. 열람 암호를 입력하세요\.(?:\n\n⚠ 암호가 올바르지 않습니다\. 다시 입력하세요\.)?$/, match => `🔒 "${match[1]}"\nThis PDF is password-protected. Enter the open password.${match[0].includes('다시 입력') ? '\n\n⚠ The password is incorrect. Enter it again.' : ''}`],
  [/^베타 (.+) — 자주 업데이트됩니다$/, match => `Beta ${match[1]} — updated frequently`],
  [/^다른 이름으로 저장 \((.+)\)$/, match => `Save as (${match[1]})`],
  [/^저장 \((.+)\)$/, match => `Save (${match[1]})`],
  [/^인쇄 \((.+)\)$/, match => `Print (${match[1]})`],
  [/^실행 취소 \((.+)\)$/, match => `Undo (${match[1]})`],
  [/^다시 실행 \((.+)\)$/, match => `Redo (${match[1]})`],
  [/^왼쪽 회전 \((.+)\)$/, match => `Rotate left (${match[1]})`],
  [/^오른쪽 회전 \((.+)\)$/, match => `Rotate right (${match[1]})`],
  [/^편집 모드 \((.+)\)$/, match => `Edit mode (${match[1]})`],
  [/^텍스트 추가 \((.+)\)$/, match => `Add text (${match[1]})`],
  [/^그리기 \((.+)\)$/, match => `Draw (${match[1]})`],
  [/^도형 삽입 \(사각형 (.+) · 타원 (.+)\)$/, match => `Insert shape (Rectangle ${match[1]} · Ellipse ${match[2]})`],
  [/^검색 \((.+)\)$/, match => `Search (${match[1]})`],
  [/^썸네일 \((.+)\)$/, match => `Thumbnails (${match[1]})`],
  [/^주석 · (.+)$/, match => `Annotation · ${EXACT.get(match[1]) || match[1]}`],
  [/^(\d+)개 파일 · (\d+)개 변환 항목 · (\d+)개 선택$/, match => `${match[1]} files · ${match[2]} conversion items · ${match[3]} selected`],
  [/^(\d+)개 변환 항목을 확인했습니다\.(?: PDF는 한 개만 처리하므로 첫 번째 파일만 열었습니다\.)? 변환할 항목을 선택하세요\.$/, match => `${match[1]} conversion items loaded. Select the items to convert.`],
  [/^(\d+)개 파일을 확인했습니다\.$/, match => `${match[1]} files loaded.`],
  [/^(\d+)개 파일$/, match => `${match[1]} files`],
  [/^(\d+)개 이미지$/, match => `${match[1]} images`],
  [/^(\d+)개 선택$/, match => `${match[1]} selected`],
  [/^(\d+)개 선택됨(?: \(텍스트·도형\/이미지 레이어별\))?$/, match => `${match[1]} selected`],
  [/^(\d+)개 문서$/, match => `${match[1]} documents`],
  [/^↗ 선택한 (\d+)개 문서 새 창에서 열기$/, match => `↗ Open ${match[1]} selected documents in a new window`],
  [/^↙ 선택한 (\d+)개 문서 원래 창으로 합치기$/, match => `↙ Merge ${match[1]} selected documents back into the original window`],
  [/^원본 파일: (.+)\nCtrl\+클릭: 개별 선택 · Shift\+클릭: 범위 선택$/, match => `Original file: ${match[1]}\nCtrl-click: individual selection · Shift-click: range selection`],
  [/^원본 파일 미지정 — 저장 시 위치 선택\nCtrl\+클릭: 개별 선택 · Shift\+클릭: 범위 선택$/, () => 'No original file — choose a location when saving\nCtrl-click: individual selection · Shift-click: range selection'],
  [/^(\d+)개 페이지 인쇄$/, match => `Print ${match[1]} pages`],
  [/^(\d+)페이지 미리보기 · (\d+)% \(Ctrl\+휠\)$/, match => `Page ${match[1]} preview · ${match[2]}% (Ctrl+wheel)`],
  [/^(.+) — (.+)과 중복$/, match => `${match[1]} — conflicts with ${EXACT.get(match[2]) || match[2]}`],
  [/^(\d+)개 문서 · (.+)$/, match => `${match[1]} documents · ${match[2]}`],
  [/^페이지에서 드래그하여 (.+) 그리기$/, match => `Drag on the page to draw ${EXACT.get(match[1]) || match[1]}`],
  [/^페이지를 탭하거나 드래그하여 (.+) 추가$/, match => `Tap or drag on the page to add ${EXACT.get(match[1]) || match[1]}`],
  [/^이미지 형식으로 복제됨 — (.+)$/, match => `Duplicated as images — ${EXACT.get(match[1]) || match[1]}`],
  [/^(\d+)페이지를 확인했습니다\. 화면에 가까운 썸네일부터 불러옵니다\.$/, match => `${match[1]} pages loaded. Thumbnails nearest the viewport load first.`],
  [/^선택 페이지를 ([A-Za-z0-9]+) ZIP으로 저장$/, match => `Save selected pages as a ${match[1]} ZIP`],
  [/^(.+) 방식을 선택했습니다\.$/, match => `${EXACT.get(match[1]) || match[1]} method selected.`],
  [/^(\d+)개 선택됨(?: \(텍스트·도형\/이미지 레이어별\))? — 옵션 일괄 변경·함께 이동·Delete 삭제$/, match => `${match[1]} selected — change options together, move together, or press Delete to remove`],
  [/^(\d+)페이지 압축 안전성 확인 중$/, match => `Validating compression safety for page ${match[1]}`],
  [/^(.+ 실패:)\s*(.+)$/, match => `${translateUiText(match[1])} ${translateUiText(match[2])}`],
  [/^(\d+)개$/, match => `${match[1]} items`],
  [/^(\d+)\/(\d+) 이미지 변환 중$/, match => `${match[1]}/${match[2]} images · Converting`],
  [/^(\d+)\/(\d+)페이지 이미지 PDF 만드는 중$/, match => `${match[1]}/${match[2]} pages · Creating image PDF`],
  [/^(\d+)\/(\d+)페이지 · 이미지 (\d+)개 압축$/, match => `${match[1]}/${match[2]} pages · ${match[3]} images compressed`],
  [/^(\d+)\/(\d+) 파일 합치는 중$/, match => `${match[1]}/${match[2]} files · Merging`],
  [/^(\d+)\/(\d+) 페이지 ([A-Za-z0-9]+) 변환 중$/, match => `${match[1]}/${match[2]} pages · Converting to ${match[3]}`],
  [/^(\d+)페이지 · 원본 (.+)$/, match => `${match[1]} pages · Original ${match[2]}`],
  [/^(.+) · (\d+)페이지$/, match => `${match[1]} · ${match[2]} pages`],
  [/^(\d+)페이지 · (.+)$/, match => `${match[1]} pages · ${match[2]}`],
  [/^— (\d+)개 페이지$/, match => `— ${match[1]} pages`],
  [/^— 미리보기 (\d+)\/(\d+) \(페이지 (\d+)\) · (\d+)개 페이지에 적용(?: · 크기변경 (\d+)개도 변경된 페이지 기준으로 자르기)? · 탭\/드래그로 범위 선택 · 창 모서리로 크기 조절$/, match => `— Preview ${match[1]}/${match[2]} (page ${match[3]}) · Apply to ${match[4]} pages${match[5] ? ` · Crop ${match[5]} resized page${match[5] === '1' ? '' : 's'} using their resized dimensions` : ''} · Tap or drag to select a range · Drag a window corner to resize`],
  [/^— (\d+)개 페이지에 적용(?: · 크기변경 (\d+)개도 변경된 페이지 기준으로 자르기)? · 탭\/드래그로 범위 선택 · 창 모서리로 크기 조절$/, match => `— Apply to ${match[1]} pages${match[2] ? ` · Crop ${match[2]} resized page${match[2] === '1' ? '' : 's'} using their resized dimensions` : ''} · Tap or drag to select a range · Drag a window corner to resize`],
  [/^— 미리보기 (\d+)\/(\d+) \(페이지 (\d+)\) · (\d+)개 페이지에 적용(?: · 크기변경 (\d+)개는 원본 자르기 후 맞춤)? · 창 모서리로 크기 조절$/, match => `— Preview ${match[1]}/${match[2]} (page ${match[3]}) · Apply to ${match[4]} pages${match[5] ? ` · ${match[5]} resized page${match[5] === '1' ? '' : 's'} crop the original before fitting` : ''} · Drag a window corner to resize`],
  [/^— (\d+)개 페이지에 적용(?: · 크기변경 (\d+)개는 원본 자르기 후 맞춤)? · 창 모서리로 크기 조절$/, match => `— Apply to ${match[1]} pages${match[2] ? ` · ${match[2]} resized page${match[2] === '1' ? '' : 's'} crop the original before fitting` : ''} · Drag a window corner to resize`],
  [/^(\d+)개 페이지$/, match => `${match[1]} pages`],
  [/^(\d+)페이지 PDF 저장을 시작했습니다\.$/, match => `Starting download of a ${match[1]}-page PDF.`],
  [/^(\d+)페이지 ([A-Za-z0-9]+) ZIP 저장을 시작했습니다\.$/, match => `Starting ${match[2]} ZIP download for ${match[1]} pages.`],
  [/^(\d+)장 PDF 저장을 시작했습니다\.$/, match => `Starting download of a PDF containing ${match[1]} images.`],
  [/^(\d+)페이지 복사 — 다른 웹 창에도 붙여넣을 수 있습니다$/, match => `${match[1]} pages copied — you can paste them into another web window.`],
  [/^(\d+)페이지 잘라내기 — 다른 웹 창에도 붙여넣을 수 있습니다$/, match => `${match[1]} pages cut — you can paste them into another web window.`],
  [/^오브젝트 (복사|잘라내기)됨 — 다른 웹 창에도 붙여넣을 수 있습니다$/, match => `Object ${match[1] === '복사' ? 'copied' : 'cut'} — you can paste it into another web window.`],
  [/^(\d+)페이지 복사됨 — Ctrl\+V로 붙여넣기 \(다른 탭도 가능\)$/, match => `${match[1]} pages copied — press Ctrl+V to paste, including into another tab.`],
  [/^(\d+)페이지 잘라내기 — Ctrl\+V로 붙여넣기 \(다른 탭도 가능\)$/, match => `${match[1]} pages cut — press Ctrl+V to paste, including into another tab.`],
  [/^(\d+)페이지를 (\d+)번 위치에 붙여넣음$/, match => `${match[1]} pages pasted at position ${match[2]}.`],
  [/^(\d+)번 위치에 빈 페이지 추가$/, match => `Blank page added at position ${match[1]}.`],
  [/^병합 완료 — 새 탭 \((\d+)페이지\), 저장하려면 💾$/, match => `Merge complete — ${match[1]} pages in a new tab. Select 💾 to save.`],
  [/^(\d+)개 페이지 크기 변경됨 \(저장 시 반영\)$/, match => `${match[1]} pages resized. Changes are applied when saved.`],
  [/^(\d+)개 페이지 잘림 \(저장 시 실제 반영\)$/, match => `${match[1]} pages cropped. Changes are applied when saved.`],
  [/^썸네일 한 줄 (\d+)장$/, match => `${match[1]} thumbnails per row.`],
  [/^(\d+)개 문서를 각각 탭으로 열었습니다$/, match => `Opened ${match[1]} documents in separate tabs.`],
  [/^(\d+)개 문서를 새 탭에서 열었습니다$/, match => `Opened ${match[1]} documents in a new tab.`],
  [/^(\d+)개 문서를 새 창에서 열었습니다$/, match => `Opened ${match[1]} documents in a new window.`],
  [/^(\d+)개 문서를 다시 합쳤습니다$/, match => `Merged ${match[1]} documents back together.`],
  [/^(\d+)개 문서를 원래 창으로 합쳤습니다$/, match => `Merged ${match[1]} documents back into the original window.`],
  [/^세션 복구 완료 \((\d+)개 문서\)$/, match => `Session restored (${match[1]} documents).`],
  [/^(.+) 병합됨 \(총 (\d+)페이지\)$/, match => `${match[1]} merged (${match[2]} pages total).`],
  [/^(.+) \((\d+)페이지\)$/, match => `${match[1]} (${match[2]} pages)`],
  [/^(\d+)페이지$/, match => `${match[1]} pages`],
  [/^(\d+) 선택$/, match => `${match[1]} selected`],
  [/^"(.+)" — 암호 입력을 취소해 열지 않았습니다$/, match => `"${match[1]}" — Password entry cancelled; the file was not opened.`],
  [/^🔒 "(.+)" — 암호를 확인하지 못해 열 수 없습니다$/, match => `🔒 "${match[1]}" — The password could not be verified, so the file cannot be opened.`],
  [/^이 주소를 새 탭에서 엽니다: (.+)$/, match => `Open this address in a new tab: ${match[1]}`],
  [/^⚠ 저장에 실패했습니다\.\n\n([\s\S]+)\n\n파일이 저장되지 않았을 수 있으니 다시 시도하세요\.$/, match => `⚠ Save failed.\n\n${match[1]}\n\nThe file may not have been saved. Please try again.`],
  [/^저장된 복구 데이터를 삭제합니다\.\n열려 있는 문서 (\d+)개는 그대로 유지되지만,\n지금 브라우저가 닫히면 복구할 수 없습니다\.\n\n삭제할까요\?$/, match => `Delete the saved recovery data?\nThe ${match[1]} open documents will remain, but they cannot be recovered if the browser closes now.`],
];

const CHINESE_DYNAMIC_RULES = [
  [/^(\d+)-page PDF loaded\. Review recognition settings and save\.$/, m => `已加载 ${m[1]} 页 PDF。请检查识别设置后保存。`],
  [/^Beta (.+) — updated frequently$/, m => `测试版 ${m[1]} — 持续更新`],
  [/^Insert shape \(Rectangle (.+) · Ellipse (.+)\)$/, m => `插入图形（矩形 ${m[1]} · 椭圆 ${m[2]}）`],
  [/^(\d+) conversion items loaded\. Select the items to convert\.$/, m => `已加载 ${m[1]} 个转换项目，请选择要转换的项目。`],
  [/^(\d+) files loaded\.$/, m => `已加载 ${m[1]} 个文件。`],
  [/^(\d+) (files|images|documents|items|pages|selected)$/, m => ({files:`${m[1]} 个文件`,images:`${m[1]} 张图片`,documents:`${m[1]} 个文档`,items:`${m[1]} 项`,pages:`${m[1]} 页`,selected:`已选择 ${m[1]} 项`})[m[2]]],
  [/^Print (\d+) pages$/, m => `打印 ${m[1]} 页`],
  [/^Page (\d+) preview$/, m => `第 ${m[1]} 页预览`],
  [/^(.+) — conflicts with (.+)$/, m => `${m[1]} — 与${translateUiText(m[2], 'zh')}冲突`],
  [/^Drag on the page to draw (.+)$/, m => `在页面上拖动以绘制${translateUiText(m[1], 'zh')}`],
  [/^Tap or drag on the page to add (.+)$/, m => `点击或在页面上拖动以添加${translateUiText(m[1], 'zh')}`],
  [/^(\d+) pages loaded\. Thumbnails nearest the viewport load first\.$/, m => `已加载 ${m[1]} 页，优先加载视图附近的缩略图。`],
  [/^Save selected pages as a (\w+) ZIP$/, m => `将所选页面保存为 ${m[1]} ZIP`],
  [/^(.+) method selected\.$/, m => `已选择${translateUiText(m[1], 'zh')}方式。`],
  [/^(\d+) selected — change options together, move together, or press Delete to remove$/, m => `已选择 ${m[1]} 项 — 可批量修改选项、一起移动或按 Delete 删除`],
  [/^Validating compression safety for page (\d+)$/, m => `正在验证第 ${m[1]} 页的压缩安全性`],
  [/^(\d+)\/(\d+) images$/, m => `${m[1]}/${m[2]} 张图片`],
  [/^(\d+)\/(\d+) pages$/, m => `${m[1]}/${m[2]} 页`],
  [/^(\d+)\/(\d+) files$/, m => `${m[1]}/${m[2]} 个文件`],
  [/^Converting to (\w+)$/, m => `正在转换为 ${m[1]}`],
  [/^(\d+) images compressed$/, m => `已压缩 ${m[1]} 张图片`],
  [/^Creating image PDF$/, () => '正在创建图片 PDF'],
  [/^Merging$/, () => '正在合并'],
  [/^Starting download of a (\d+)-page PDF\.$/, m => `已开始下载 ${m[1]} 页 PDF。`],
  [/^Starting (\w+) ZIP download for (\d+) pages\.$/, m => `已开始下载包含 ${m[2]} 页的 ${m[1]} ZIP。`],
  [/^Starting download of a PDF containing (\d+) images\.$/, m => `已开始下载包含 ${m[1]} 张图片的 PDF。`],
  [/^(\d+) pages (copied|cut) — (?:you can paste them into another web window\.|press Ctrl\+V to paste, including into another tab\.)$/, m => `已${m[2] === 'copied' ? '复制' : '剪切'} ${m[1]} 页 — 按 Ctrl+V 粘贴，也可粘贴到其他标签页或网页窗口。`],
  [/^Object (copied|cut) — you can paste it into another web window\.$/, m => `已${m[1] === 'copied' ? '复制' : '剪切'}对象 — 可粘贴到其他网页窗口。`],
  [/^(\d+) pages pasted at position (\d+)\.$/, m => `已在第 ${m[2]} 个位置粘贴 ${m[1]} 页。`],
  [/^Blank page added at position (\d+)\.$/, m => `已在第 ${m[1]} 个位置添加空白页。`],
  [/^Merge complete — (\d+) pages in a new tab\. Select 💾 to save\.$/, m => `合并完成 — 新标签页中共 ${m[1]} 页，点击 💾 保存。`],
  [/^(\d+) pages (resized|cropped)\. Changes are applied when saved\.$/, m => `已${m[2] === 'resized' ? '调整大小' : '裁剪'} ${m[1]} 页，保存时应用。`],
  [/^(\d+) thumbnails per row\.$/, m => `每行 ${m[1]} 个缩略图。`],
  [/^Opened (\d+) documents in (separate tabs|a new tab|a new window)\.$/, m => `已在${{ 'separate tabs':'独立标签页', 'a new tab':'新标签页', 'a new window':'新窗口' }[m[2]]}中打开 ${m[1]} 个文档。`],
  [/^Merged (\d+) documents back (together|into the original window)\.$/, m => `已将 ${m[1]} 个文档${m[2] === 'together' ? '重新合并' : '合并回原窗口'}。`],
  [/^Session restored \((\d+) documents\)\.$/, m => `会话已恢复（${m[1]} 个文档）。`],
  [/^(.+) merged \((\d+) pages total\)\.$/, m => `${m[1]} 已合并（共 ${m[2]} 页）。`],
  [/^(.+) \((\d+) pages\)$/, m => `${m[1]}（${m[2]} 页）`],
  [/^"(.+)" — Password entry cancelled; the file was not opened\.$/, m => `“${m[1]}” — 已取消输入密码，未打开文件。`],
  [/^🔒 "(.+)" — The password could not be verified, so the file cannot be opened\.$/, m => `🔒 “${m[1]}” — 无法确认密码，不能打开文件。`],
  [/^Open this address in a new tab: (.+)$/, m => `在新标签页中打开此地址：${m[1]}`],
];

const SKIP_SUBTREE_SELECTOR = [
  'pre', 'code', '[data-file-name]', '[data-document-name]',
  'script', 'style', 'noscript', 'textarea', 'svg', '[contenteditable="true"]',
  '[data-i18n-ignore]', '.textLayer', '.textMark', '.nm', '#stFile',
  '#pagesBox', '#sidebar',
].join(',');

const originalText = new WeakMap();
const originalAttributes = new WeakMap();
const renderedText = new WeakMap();
const renderedAttributes = new WeakMap();
let currentLanguage = 'ko';
let mutating = false;
export const SUPPORTED_LANGUAGES = Object.freeze(['ko', 'en', 'ja', 'vi', 'zh']);
const languageNames = { ko: '한국어', en: 'English', ja: '日本語', vi: 'Tiếng Việt', zh: '简体中文' };
const languageCodes = { ko: 'KR', en: 'EN', ja: 'JP', vi: 'VN', zh: 'ZH' };
const languageLabels = { ko: '언어', en: 'Language', ja: '言語', vi: 'Ngôn ngữ', zh: '语言' };
const reverseEnglish = new Map([...EXACT].map(([ko, en]) => [en, ko]));
const reverseExtra = new Map(Object.entries(EXTRA_TRANSLATIONS).flatMap(([en, values]) => values.map(value => [value, en])));
const trimmedExtra = new Map(Object.entries(EXTRA_TRANSLATIONS).map(([en, values]) => [en.trim(), values.map(value => value.trim())]));
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fragmentKeys = [...new Set(FRAGMENTS.map(([, en]) => en))].filter(key => key && EXTRA_TRANSLATIONS[key]).sort((a, b) => b.length - a.length);
const extraFragments = new RegExp(`(?<![\\p{L}])(?:${fragmentKeys.map(escapePattern).join('|')})(?![\\p{L}])`, 'gu');

export function normalizeLanguage(value) {
  const language = String(value || '').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
}

function translateEnglish(source) {
  if (EXACT.has(source)) return EXACT.get(source);
  if (!KOREAN.test(source)) return source;
  for (const [pattern, replace] of DYNAMIC_RULES) {
    const match = source.match(pattern);
    if (match) return replace(match);
  }
  for (const [ko, en] of FRAGMENTS) source = source.replaceAll(ko, en);
  return source;
}

export function translateUiText(value, language = 'en') {
  const source = String(value ?? '');
  if (!source.trim()) return source;
  language = normalizeLanguage(language);
  if ((language === 'ja' || language === 'vi' || language === 'zh') && Object.hasOwn(EXTRA_TRANSLATIONS, source)) return EXTRA_TRANSLATIONS[source][language === 'ja' ? 0 : language === 'vi' ? 1 : 2] || source;
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  let core = source.trim();
  if (!EXACT.has(core) && !Object.hasOwn(EXTRA_TRANSLATIONS, core)) core = reverseExtra.get(core) || core;
  if (language === 'ko') return leading + (reverseEnglish.get(core) || core) + trailing;
  core = translateEnglish(core);
  if (language === 'en') return leading + core + trailing;
  const index = language === 'ja' ? 0 : language === 'vi' ? 1 : 2;
  const exact = (Object.hasOwn(EXTRA_TRANSLATIONS, core) ? EXTRA_TRANSLATIONS[core] : null) || trimmedExtra.get(core);
  if (exact) return leading + (exact[index] || core) + trailing;
  if (language === 'zh') {
    for (const [pattern, replace] of CHINESE_DYNAMIC_RULES) {
      const match = core.match(pattern);
      if (match) return leading + replace(match) + trailing;
    }
  }
  const parts = core.split(/(\s+[|·—]\s+|\n+)/);
  if (parts.length > 1) return leading + parts.map((part, i) => i % 2 ? part : translateUiText(part, language)).join('') + trailing;
  const shortcut = core.match(/^(.+?) (\([^()]+\))$/);
  if (shortcut && Object.hasOwn(EXTRA_TRANSLATIONS, shortcut[1])) return leading + (EXTRA_TRANSLATIONS[shortcut[1]][index] || shortcut[1]) + ' ' + shortcut[2] + trailing;
  const tour = core.match(/^Get started in (\d+) steps$/);
  if (tour) return leading + (language === 'ja' ? `${tour[1]}ステップで開始` : language === 'vi' ? `Bắt đầu trong ${tour[1]} bước` : `${tour[1]} 步快速上手`) + trailing;
  const files = [];
  core = core.replace(/"[^"\n]*\.(?:pdf|pptx?|docx?|xlsx?|hwpx?|png|jpe?g|webp|zip)"|[^\s<>"']+\.(?:pdf|pptx?|docx?|xlsx?|hwpx?|png|jpe?g|webp|zip)\b/gi, value => {
    files.push(value); return `\uE000${files.length - 1}\uE001`;
  });
  core = core.replace(/\d+(?:\.\d+)+/g, value => {
    files.push(value); return `\uE000${files.length - 1}\uE001`;
  });
  core = core.replace(extraFragments, key => EXTRA_TRANSLATIONS[key][index] || key);
  return leading + core.replace(/\uE000(\d+)\uE001/g, (_, n) => files[n]) + trailing;
}

export function setLocalizedText(element, value) {
  if (!element) return;
  const source = String(value ?? '');
  element.textContent = translateUiText(source, currentLanguage);
  const node = element.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  originalText.set(node, source);
  renderedText.set(node, node.nodeValue);
}

export function setLocalizedAttribute(element, name, value) {
  if (!element) return;
  const source = String(value ?? '');
  let originals = originalAttributes.get(element);
  if (!originals) originalAttributes.set(element, originals = new Map());
  originals.set(name, source);
  let rendered = renderedAttributes.get(element);
  if (!rendered) renderedAttributes.set(element, rendered = new Map());
  const translated = translateUiText(source, currentLanguage);
  rendered.set(name, translated);
  element.setAttribute(name, translated);
}

function shouldSkip(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !element || Boolean(element.closest(SKIP_SUBTREE_SELECTOR));
}

function createUiWalker(root) {
  return document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches(SKIP_SUBTREE_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (node.nodeType === Node.TEXT_NODE && shouldSkip(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
}

function translateTextNode(node) {
  if (shouldSkip(node)) return;
  if (!originalText.has(node) || node.nodeValue !== renderedText.get(node)) originalText.set(node, node.nodeValue);
  const translated = translateUiText(originalText.get(node), currentLanguage);
  renderedText.set(node, translated);
  if (translated !== node.nodeValue) node.nodeValue = translated;
}

function translateAttributes(element) {
  if (shouldSkip(element)) return;
  for (const name of ['title', 'aria-label', 'placeholder', 'alt']) {
    const value = element.getAttribute(name);
    if (!value) continue;
    let originals = originalAttributes.get(element);
    if (!originals) originalAttributes.set(element, originals = new Map());
    let rendered = renderedAttributes.get(element);
    if (!rendered) renderedAttributes.set(element, rendered = new Map());
    if (!originals.has(name) || value !== rendered.get(name)) originals.set(name, value);
    const translated = translateUiText(originals.get(name), currentLanguage);
    rendered.set(name, translated);
    if (translated !== value) element.setAttribute(name, translated);
  }
}

function translateTree(root = document.body) {
  if (!root || shouldSkip(root)) return;
  mutating = true;
  try {
    if (root.nodeType === Node.TEXT_NODE) translateTextNode(root);
    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    const walker = createUiWalker(root);
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType === Node.TEXT_NODE) translateTextNode(walker.currentNode);
      else translateAttributes(walker.currentNode);
    }
  } finally { mutating = false; }
}

function updateMetadata(language) {
  document.documentElement.lang = language === 'zh' ? 'zh-Hans' : language;
  document.title = translateUiText('PDF 편집기', language);
}

let menu = null;
function closeMenu(focus = false) {
  if (!menu) return;
  menu.remove(); menu = null;
  const button = document.querySelector('[data-language-toggle]');
  button?.setAttribute('aria-expanded', 'false');
  if (focus) button?.focus({ preventScroll: true });
}
function openMenu(button) {
  if (menu) { closeMenu(true); return; }
  menu = document.createElement('div');
  menu.id = 'dayday-language-menu'; menu.className = 'dayday-language-menu';
  menu.dataset.i18nIgnore = ''; menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', languageLabels[currentLanguage]);
  for (const language of SUPPORTED_LANGUAGES) {
    const option = document.createElement('button');
    option.type = 'button'; option.lang = language === 'zh' ? 'zh-Hans' : language; option.dataset.language = language;
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', String(language === currentLanguage));
    option.textContent = languageNames[language];
    option.addEventListener('click', event => {
      event.stopPropagation(); closeMenu(); setLanguage(language, { persist: true }); button.focus({ preventScroll: true });
    });
    menu.append(option);
  }
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const items = [...menu.children], index = items.indexOf(document.activeElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (event.key === 'Tab') closeMenu();
  });
  document.body.append(menu);
  button.setAttribute('aria-expanded', 'true');
  const rect = button.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth)) + 'px';
  menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 8)) + 'px';
  menu.querySelector('[aria-checked="true"]').focus({ preventScroll: true });
}

function ensureToggle() {
  let button = document.querySelector('[data-language-toggle]');
  if (!button) {
    button = document.createElement('a');
    button.className = 'dayday-language-toggle';
    button.dataset.languageToggle = '';
    const editorSettings = document.querySelector('#btnSettings');
    if (editorSettings) editorSettings.before(button);
    else document.body.append(button);
  }
  button.dataset.i18nIgnore = '';
  if (!button.dataset.languageBound) {
    button.dataset.languageBound = 'true';
    button.setAttribute('role', 'button'); button.tabIndex = 0;
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'dayday-language-menu');
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openMenu(button); });
    button.addEventListener('keydown', event => {
      if ([' ', 'Enter', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openMenu(button); }
    });
  }
  return button;
}

function updateToggle() {
  const button = ensureToggle();
  button.removeAttribute('href'); button.removeAttribute('hreflang');
  button.textContent = languageCodes[currentLanguage];
  if (button.closest('#toolbar')) {
    button.classList.add('btn');
    const code = document.createElement('span'); code.className = 'dayday-language-code'; code.textContent = button.textContent;
    const label = document.createElement('span'); label.className = 'lbl'; label.textContent = languageLabels[currentLanguage];
    button.replaceChildren(code, label);
  }
  button.title = `${languageLabels[currentLanguage]} · ${languageNames[currentLanguage]}`;
  button.setAttribute('aria-label', button.title);
}

export function setLanguage(language, { persist = false } = {}) {
  currentLanguage = normalizeLanguage(language);
  if (persist) { try { localStorage.setItem(STORAGE_KEY, currentLanguage); } catch {} }
  translateTree();
  updateMetadata(currentLanguage);
  updateToggle();
  document.documentElement.dataset.language = currentLanguage;
  window.dispatchEvent(new CustomEvent('daydaypdf:languagechange', { detail: { language: currentLanguage } }));
}

function initialLanguage() {
  const forced = document.documentElement.dataset.daydayLanguage;
  if (forced) return normalizeLanguage(forced);
  try { const stored = localStorage.getItem(STORAGE_KEY); if (stored) return normalizeLanguage(stored); } catch {}
  return normalizeLanguage(navigator.languages?.[0] || navigator.language || 'en');
}

function installStyles() {
  if (!document.querySelector('[data-language-style="custom"]')) {
    const style = document.createElement('style');
    style.textContent = `.dayday-language-toggle{appearance:none;display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;min-width:24px;height:26px;margin:0;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:inherit;opacity:.72;text-decoration:none;font:600 11px/1 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer}.dayday-language-toggle:hover{opacity:1}.dayday-language-toggle:focus-visible{outline:2px solid #4c8dff;outline-offset:2px}body>.dayday-language-toggle{position:fixed;z-index:30;top:14px;right:18px}.site-header-inner>.dayday-language-toggle,.main-topbar>.dayday-language-toggle{margin-left:auto}#toolbar>.dayday-language-toggle{margin-right:0}`;
    document.head.append(style);
  }
  if (!document.querySelector('[data-language-menu-style]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/assets/styles/language-menu.css';
    link.dataset.languageMenuStyle = ''; document.head.append(link);
  }
}

function installDialogTranslation() {
  for (const name of ['alert', 'confirm', 'prompt']) {
    const original = window[name]?.bind(window); if (!original) continue;
    window[name] = (...args) => original(...args.map((value, index) => index === 0 && typeof value === 'string' ? translateUiText(value, currentLanguage) : value));
  }
}

function start() {
  if (window.DaydayPDFI18n) return;
  installStyles(); installDialogTranslation();
  window.DaydayPDFI18n = Object.freeze({
    get language() { return currentLanguage; }, setLanguage,
    t: (value, language = currentLanguage) => translateUiText(value, language),
    setText: setLocalizedText, setAttribute: setLocalizedAttribute,
  });
  setLanguage(initialLanguage());
  document.addEventListener('pointerdown', event => {
    if (menu && !menu.contains(event.target) && !event.target.closest('[data-language-toggle]')) closeMenu();
  }, true);
  window.addEventListener('resize', () => closeMenu());
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY && event.newValue && event.newValue !== currentLanguage) setLanguage(event.newValue);
  });
  if (document.querySelector('meta[name="pdf-editor-version"]') || document.querySelector('[data-tool-root]')) {
    const observer = new MutationObserver(records => {
      if (mutating) return;
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target);
        if (record.type === 'attributes') translateAttributes(record.target);
        for (const node of record.addedNodes) translateTree(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'alt'] });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
