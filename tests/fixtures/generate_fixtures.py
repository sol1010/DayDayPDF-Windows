from __future__ import annotations

import hashlib
import io
import json
import math
import random
import secrets
from contextlib import contextmanager
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont
from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import A4, A5, LETTER, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent
PAGE_PX = (1100, 1556)
SCAN_PAGE_SIZE = A4
RNG_SEED = 20260821


@contextmanager
def deterministic_fixture_secrets(seed: int):
    """Make fixture encryption reproducible; never use this for real secrets."""
    rng = random.Random(seed)
    original = secrets.token_bytes
    secrets.token_bytes = lambda length: bytes(rng.randrange(256) for _ in range(length))
    try:
        yield
    finally:
        secrets.token_bytes = original


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def page_image(page_number: int, document_pages: int) -> bytes:
    width, height = PAGE_PX
    rng = random.Random(RNG_SEED + document_pages * 1000 + page_number)
    base = Image.new("RGB", PAGE_PX, (244, 241, 232))
    draw = ImageDraw.Draw(base)
    font = ImageFont.load_default()

    tint = (
        38 + (page_number * 17) % 90,
        78 + (page_number * 11) % 100,
        120 + (page_number * 7) % 90,
    )
    draw.rectangle((0, 0, width, 105), fill=tint)
    draw.text((52, 36), f"SYNTHETIC COLOR SCAN - PAGE {page_number}/{document_pages}", fill=(255, 255, 255), font=font)

    margin = 70
    y = 145
    draw.text((margin, y), "Regression fixture: raster-only document page", fill=(28, 31, 36), font=font)
    y += 38

    photo_w = 380
    photo_h = 260
    photo_x = width - margin - photo_w
    photo_y = y
    for row in range(photo_h):
        ratio = row / max(1, photo_h - 1)
        color = (
            int(45 + 145 * ratio),
            int(90 + 80 * (1 - ratio)),
            int(155 + 65 * math.sin((ratio + page_number * 0.03) * math.pi) ** 2),
        )
        draw.line((photo_x, photo_y + row, photo_x + photo_w, photo_y + row), fill=color)
    for _ in range(18):
        x0 = rng.randint(photo_x, photo_x + photo_w - 50)
        y0 = rng.randint(photo_y, photo_y + photo_h - 50)
        size = rng.randint(20, 75)
        draw.ellipse((x0, y0, x0 + size, y0 + size), outline=(255, 255, 255), width=3)

    chart_x = margin
    chart_y = y + 30
    chart_w = 480
    chart_h = 220
    draw.rectangle((chart_x, chart_y, chart_x + chart_w, chart_y + chart_h), fill=(252, 252, 249), outline=(90, 90, 90), width=2)
    palette = [(43, 108, 176), (230, 126, 34), (39, 174, 96), (142, 68, 173), (192, 57, 43)]
    for index, color in enumerate(palette):
        bar_h = rng.randint(45, chart_h - 20)
        x0 = chart_x + 35 + index * 86
        draw.rectangle((x0, chart_y + chart_h - bar_h, x0 + 52, chart_y + chart_h), fill=color)

    y += 315
    line_widths = [0.94, 0.83, 0.91, 0.68, 0.88, 0.76, 0.95, 0.61]
    for section in range(4):
        section_color = palette[(page_number + section) % len(palette)]
        draw.rectangle((margin, y, margin + 14, y + 31), fill=section_color)
        draw.text((margin + 28, y + 9), f"Section {section + 1}", fill=(35, 38, 42), font=font)
        y += 44
        for line in range(8):
            fraction = line_widths[(line + page_number + section) % len(line_widths)]
            shade = 95 + ((line * 11 + page_number) % 50)
            draw.rounded_rectangle(
                (margin, y, margin + int((width - 2 * margin) * fraction), y + 9),
                radius=4,
                fill=(shade, shade, shade),
            )
            y += 22
        y += 25

    draw.text((margin, height - 55), f"fixture-id scan-{document_pages}-{page_number:03d}", fill=(80, 80, 80), font=font)

    noise = Image.effect_noise((width // 4, height // 4), 7.5).resize(PAGE_PX, Image.Resampling.BILINEAR).convert("RGB")
    base = Image.blend(base, noise, 0.025)
    base = ImageEnhance.Contrast(base).enhance(0.98)
    output = io.BytesIO()
    base.save(output, format="JPEG", quality=72, optimize=True, progressive=True)
    return output.getvalue()


def make_scan_pdf(path: Path, page_count: int) -> None:
    pdf = canvas.Canvas(str(path), pagesize=SCAN_PAGE_SIZE, pageCompression=1, invariant=1)
    pdf.setTitle(f"Synthetic color scan - {page_count} pages")
    pdf.setAuthor("PDF editor regression fixtures")
    width, height = SCAN_PAGE_SIZE
    for page_number in range(1, page_count + 1):
        image = ImageReader(io.BytesIO(page_image(page_number, page_count)))
        pdf.drawImage(image, 0, 0, width=width, height=height, preserveAspectRatio=False, mask="auto")
        pdf.showPage()
    pdf.save()


def make_text_vector_links(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1, invariant=1)
    pdf.setTitle("Text, vector and links fixture")
    pdf.setAuthor("PDF editor regression fixtures")
    width, height = A4
    for page_number in range(1, 7):
        destination = f"page-{page_number}"
        pdf.bookmarkPage(destination)
        pdf.addOutlineEntry(f"Fixture page {page_number}", destination, level=0)
        pdf.setFillColor(HexColor("#244A73"))
        pdf.rect(0, height - 72, width, 72, fill=1, stroke=0)
        pdf.setFillColor(white)
        pdf.setFont("Helvetica-Bold", 21)
        pdf.drawString(42, height - 46, f"Text and vector fixture - page {page_number}")
        pdf.setFillColor(black)
        pdf.setFont("Helvetica", 11)
        y = height - 108
        for line in range(16):
            pdf.drawString(52, y, f"Searchable sample line {line + 1:02d} on page {page_number}: alpha beta gamma 2026")
            y -= 22
        pdf.setFillColor(HexColor("#E67E22"))
        pdf.circle(135, 230, 55, fill=1, stroke=0)
        pdf.setFillColor(HexColor("#2E86C1"))
        pdf.roundRect(230, 178, 260, 105, 14, fill=1, stroke=0)
        pdf.setFillColor(white)
        pdf.setFont("Helvetica-Bold", 13)
        pdf.drawCentredString(360, 225, "Vector objects and searchable text")
        if page_number == 1:
            pdf.setFillColor(HexColor("#1A5FB4"))
            pdf.drawString(52, 110, "External fixture link: https://example.com/")
            pdf.linkURL("https://example.com/", (52, 105, 300, 124), relative=0, thickness=1)
            pdf.drawString(52, 78, "Internal link to page 3")
            pdf.linkRect("", "page-3", (52, 73, 190, 92), relative=0, thickness=1)
        pdf.showPage()
    pdf.save()


def make_mixed_pages(path: Path) -> None:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=1, invariant=1)
    page_sizes = [A4, LETTER, landscape(A4), A5, landscape(LETTER), A4, A5, landscape(A5)]
    for index, size in enumerate(page_sizes, start=1):
        pdf.setPageSize(size)
        width, height = size
        pdf.setFillColor(HexColor(["#1F618D", "#117864", "#7D3C98", "#B03A2E"][index % 4]))
        pdf.rect(0, 0, width, height, fill=1, stroke=0)
        pdf.setFillColor(white)
        pdf.setFont("Helvetica-Bold", 20)
        pdf.drawCentredString(width / 2, height / 2 + 12, f"Mixed page {index}")
        pdf.setFont("Helvetica", 12)
        pdf.drawCentredString(width / 2, height / 2 - 18, f"{width:.1f} x {height:.1f} pt")
        pdf.showPage()
    pdf.save()

    reader = PdfReader(io.BytesIO(buffer.getvalue()))
    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        if index in {1, 5}:
            page.rotate(90)
        if index == 3:
            box = page.mediabox
            inset_x = float(box.width) * 0.08
            inset_y = float(box.height) * 0.06
            page.cropbox.lower_left = (float(box.left) + inset_x, float(box.bottom) + inset_y)
            page.cropbox.upper_right = (float(box.right) - inset_x, float(box.top) - inset_y)
        writer.add_page(page)
    writer.add_metadata({"/Title": "Mixed page sizes, rotations and crop boxes"})
    with path.open("wb") as stream:
        writer.write(stream)


def make_annotations_form(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1, invariant=1)
    pdf.setTitle("Annotations and AcroForm fixture")
    width, height = A4

    pdf.setFillColor(HexColor("#1B4F72"))
    pdf.rect(0, height - 82, width, 82, fill=1, stroke=0)
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 22)
    pdf.drawString(40, height - 52, "Annotations and form fixture")
    pdf.setFillColor(black)
    pdf.setFont("Helvetica", 12)
    pdf.drawString(50, height - 125, "Name")
    pdf.acroForm.textfield(
        name="fixture_name",
        tooltip="Fixture name",
        value="Fixture User",
        x=120,
        y=height - 145,
        width=300,
        height=26,
        borderStyle="inset",
        forceBorder=True,
    )
    pdf.drawString(50, height - 185, "Approved")
    pdf.acroForm.checkbox(
        name="fixture_approved",
        tooltip="Fixture approved",
        checked=True,
        x=120,
        y=height - 202,
        buttonStyle="check",
        borderWidth=1,
        forceBorder=True,
    )
    pdf.drawString(50, height - 245, "Priority")
    pdf.acroForm.choice(
        name="fixture_priority",
        tooltip="Fixture priority",
        value="Normal",
        options=["Low", "Normal", "High"],
        x=120,
        y=height - 262,
        width=180,
        height=26,
        borderWidth=1,
        forceBorder=True,
    )
    pdf.textAnnotation("Synthetic sticky note", Rect=(440, height - 180, 470, height - 150))
    pdf.setFillColor(HexColor("#1A5FB4"))
    pdf.drawString(50, 150, "External annotation link")
    pdf.linkURL("https://example.com/form-fixture", (50, 145, 240, 166), relative=0, thickness=1)
    pdf.showPage()

    pdf.setFillColor(HexColor("#117864"))
    pdf.rect(0, 0, width, height, fill=1, stroke=0)
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawCentredString(width / 2, height / 2, "Second page for annotation and form preservation")
    pdf.showPage()
    pdf.save()


def clone_and_encrypt(
    source: Path,
    target: Path,
    *,
    user: str,
    owner: str,
    permissions: UserAccessPermissions,
    seed: int,
) -> None:
    reader = PdfReader(str(source))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    with deterministic_fixture_secrets(seed):
        writer.encrypt(
            user_password=user,
            owner_password=owner,
            permissions_flag=permissions,
            algorithm="AES-256-R5",
        )
        with target.open("wb") as stream:
            writer.write(stream)


def describe(path: Path, password: str | None = None) -> dict[str, object]:
    reader = PdfReader(str(path))
    encrypted = reader.is_encrypted
    if encrypted and password is not None:
        if not reader.decrypt(password):
            raise RuntimeError(f"Could not decrypt {path.name}")
    return {
        "file": path.name,
        "pages": len(reader.pages),
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "encrypted": encrypted,
    }


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    scan_counts = [15, 50, 130]
    for count in scan_counts:
        make_scan_pdf(ROOT / f"scan-color-{count}p.pdf", count)

    text_path = ROOT / "text-vector-links.pdf"
    make_text_vector_links(text_path)
    make_mixed_pages(ROOT / "mixed-page-sizes-rotations.pdf")
    make_annotations_form(ROOT / "annotations-form.pdf")

    clone_and_encrypt(
        text_path,
        ROOT / "encrypted-user-password.pdf",
        user="fixture-open",
        owner="fixture-owner",
        permissions=UserAccessPermissions.PRINT | UserAccessPermissions.EXTRACT | UserAccessPermissions.EXTRACT_TEXT_AND_GRAPHICS,
        seed=RNG_SEED + 1,
    )
    clone_and_encrypt(
        text_path,
        ROOT / "restricted-owner-permissions.pdf",
        user="",
        owner="fixture-owner",
        permissions=UserAccessPermissions.PRINT | UserAccessPermissions.PRINT_TO_REPRESENTATION,
        seed=RNG_SEED + 2,
    )

    descriptions = []
    for count in scan_counts:
        descriptions.append(describe(ROOT / f"scan-color-{count}p.pdf"))
    descriptions.extend(
        [
            describe(text_path),
            describe(ROOT / "mixed-page-sizes-rotations.pdf"),
            describe(ROOT / "annotations-form.pdf"),
            describe(ROOT / "encrypted-user-password.pdf", "fixture-open"),
            describe(ROOT / "restricted-owner-permissions.pdf", ""),
        ]
    )
    manifest = {
        "schemaVersion": 1,
        "generatorSeed": RNG_SEED,
        "usageProfile": {
            "documentType": "color-scanned-pdf",
            "pageRange": [15, 130],
            "representativePageCounts": scan_counts,
            "deviceClass": "general-desktop-or-laptop",
        },
        "files": descriptions,
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for item in descriptions:
        print(f"{item['file']}: {item['pages']} pages, {item['bytes']} bytes")


if __name__ == "__main__":
    main()
