from __future__ import annotations

import argparse
import json
from pathlib import Path

from pypdf import PdfReader


def inspect_pdf(path: Path, password: str | None) -> dict[str, object]:
    reader = PdfReader(str(path), strict=False)
    encrypted = reader.is_encrypted
    decrypt_result = None
    if encrypted:
        decrypt_result = int(reader.decrypt(password or ""))
        if not decrypt_result:
            raise ValueError("PDF password was rejected")

    pages = reader.pages
    sizes = sorted(
        {
            (round(float(page.mediabox.width), 3), round(float(page.mediabox.height), 3))
            for page in pages
        }
    )
    rotations = sorted({int(page.get("/Rotate", 0)) % 360 for page in pages})
    text_page_count = sum(bool((page.extract_text() or "").strip()) for page in pages)
    annotation_count = sum(len(page.get("/Annots") or []) for page in pages)
    fields = reader.get_fields() or {}
    permissions = reader.user_access_permissions if encrypted else None

    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "encrypted": encrypted,
        "decryptResult": decrypt_result,
        "pages": len(pages),
        "pageSizesPt": [list(size) for size in sizes],
        "rotations": rotations,
        "textPageCount": text_page_count,
        "annotationCount": annotation_count,
        "formFields": sorted(fields),
        "permissions": int(permissions) if permissions is not None else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a saved PDF regression artifact")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--password")
    parser.add_argument("--expect-pages", type=int)
    args = parser.parse_args()

    result = inspect_pdf(args.pdf.resolve(), args.password)
    if args.expect_pages is not None and result["pages"] != args.expect_pages:
        raise SystemExit(f"expected {args.expect_pages} pages, got {result['pages']}")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
