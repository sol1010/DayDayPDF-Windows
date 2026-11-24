# PDF 회귀 테스트 fixture

모든 파일은 공개 자료가 아닌 결정론적 합성 데이터다. 실제 사용자 문서는 포함하지 않는다.

## 실사용 대표 스캔 문서

| 파일 | 페이지 | 성격 |
|---|---:|---|
| `scan-color-15p.pdf` | 15 | 일반적인 짧은 컬러 스캔 |
| `scan-color-50p.pdf` | 50 | 중간 크기 컬러 스캔 |
| `scan-color-130p.pdf` | 130 | 실사용 범위 상단의 컬러 스캔 스트레스 fixture |

세 문서는 페이지 전체가 JPEG 이미지인 무텍스트 PDF다. 각 페이지 이미지는 서로 달라 PDF 내부 이미지 중복 제거에 의해 테스트 부하가 사라지지 않는다.

## 기능 fixture

| 파일 | 용도 |
|---|---|
| `text-vector-links.pdf` | 텍스트, 벡터, 내부·외부 링크, 검색과 렌더 |
| `mixed-page-sizes-rotations.pdf` | A4·Letter·A5·가로 페이지, rotation과 crop box |
| `annotations-form.pdf` | 텍스트 주석, 링크, AcroForm 텍스트·체크박스·선택 필드 |
| `encrypted-user-password.pdf` | 열람 암호 흐름. 암호: `fixture-open` |
| `restricted-owner-permissions.pdf` | 빈 사용자 암호로 열리지만 수정 권한 제한. 소유자 암호: `fixture-owner` |

## 생성과 검증

```powershell
python tests/fixtures/generate_fixtures.py
python -m unittest tests/characterization/test_fixture_contracts.py
node --test tests/characterization/static_contracts.test.mjs
```

`manifest.json`은 생성된 파일의 페이지 수, 크기와 SHA-256을 기록한다. fixture를 의도적으로 다시 생성한 경우 manifest 변경도 함께 검토한다.

`sol_project.json`, `SolTx`, 과거 autosave payload fixture는 현재 앱 자체에서 생성한 기준 파일이 필요하므로 별도 호환 fixture 세트로 추가한다.

## 상태 전송 payload fixture

`payloads/autosave-v2.json`은 IndexedDB의 `session` 값 구조를, `payloads/detach-v1.json`은 분리 창 전송 구조를 고정한다. 두 구조에서 `handle`과 `fileHandle`은 서로 다른 현재 필드명이므로 통합하거나 이름을 바꾸지 않는다.

저장 결과 PDF는 다음 검사기로 페이지 수, 크기, 회전, 텍스트, 주석, 양식과 암호 권한을 JSON으로 기록한다.

```powershell
python tests/characterization/inspect_pdf.py output.pdf --expect-pages 50
python tests/characterization/inspect_pdf.py tests/fixtures/encrypted-user-password.pdf --password fixture-open --expect-pages 6
```
