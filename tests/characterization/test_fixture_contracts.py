from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from pypdf import PdfReader
from pypdf.constants import UserAccessPermissions


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


class FixtureContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))

    def test_manifest_files_exist_and_hashes_match(self) -> None:
        self.assertEqual(self.manifest["schemaVersion"], 1)
        for item in self.manifest["files"]:
            path = FIXTURES / item["file"]
            self.assertTrue(path.is_file(), path)
            self.assertEqual(path.stat().st_size, item["bytes"])
            self.assertEqual(file_sha256(path), item["sha256"])

    def test_color_scan_page_counts_and_no_text_layer(self) -> None:
        for count in (15, 50, 130):
            reader = PdfReader(str(FIXTURES / f"scan-color-{count}p.pdf"))
            self.assertEqual(len(reader.pages), count)
            for index in {0, count // 2, count - 1}:
                self.assertFalse((reader.pages[index].extract_text() or "").strip())

    def test_text_vector_fixture_is_searchable_and_has_links(self) -> None:
        reader = PdfReader(str(FIXTURES / "text-vector-links.pdf"))
        self.assertEqual(len(reader.pages), 6)
        self.assertIn("Searchable sample line", reader.pages[0].extract_text())
        annotations = reader.pages[0].get("/Annots") or []
        self.assertGreaterEqual(len(annotations), 2)

    def test_mixed_page_sizes_rotations_and_crop(self) -> None:
        reader = PdfReader(str(FIXTURES / "mixed-page-sizes-rotations.pdf"))
        self.assertEqual(len(reader.pages), 8)
        rotations = [int(page.get("/Rotate", 0)) % 360 for page in reader.pages]
        self.assertIn(90, rotations)
        sizes = {(round(float(page.mediabox.width)), round(float(page.mediabox.height))) for page in reader.pages}
        self.assertGreaterEqual(len(sizes), 4)
        crop = reader.pages[3].cropbox
        media = reader.pages[3].mediabox
        self.assertLess(float(crop.width), float(media.width))
        self.assertLess(float(crop.height), float(media.height))

    def test_form_fields_widgets_values_and_appearances(self) -> None:
        reader = PdfReader(str(FIXTURES / "annotations-form.pdf"))
        fields = reader.get_fields() or {}
        self.assertEqual(set(fields), {"fixture_name", "fixture_approved", "fixture_priority"})
        self.assertEqual(fields["fixture_name"].get("/V"), "Fixture User")
        self.assertEqual(fields["fixture_priority"].get("/V"), "Normal")
        widgets = []
        for page in reader.pages:
            for ref in page.get("/Annots") or []:
                annotation = ref.get_object()
                if annotation.get("/Subtype") == "/Widget":
                    widgets.append(annotation)
        self.assertEqual(len(widgets), 3)
        for widget in widgets:
            parent_ref = widget.get("/Parent")
            parent = parent_ref.get_object() if parent_ref is not None else None
            name = widget.get("/T") or (parent.get("/T") if parent is not None else None)
            effective_value = widget.get("/V")
            if effective_value is None and parent is not None:
                effective_value = parent.get("/V")
            self.assertIn(name, fields)
            self.assertEqual(effective_value, fields[name].get("/V"))
            appearance = widget.get("/AP")
            self.assertIsNotNone(appearance)
            self.assertIsNotNone(appearance.get("/N"))

    def test_encrypted_open_password_fixture(self) -> None:
        reader = PdfReader(str(FIXTURES / "encrypted-user-password.pdf"))
        self.assertTrue(reader.is_encrypted)
        self.assertFalse(reader.decrypt("wrong-password"))
        self.assertTrue(reader.decrypt("fixture-open"))
        self.assertEqual(len(reader.pages), 6)

    def test_restricted_owner_permissions_fixture(self) -> None:
        reader = PdfReader(str(FIXTURES / "restricted-owner-permissions.pdf"))
        self.assertTrue(reader.is_encrypted)
        self.assertTrue(reader.decrypt(""))
        self.assertEqual(len(reader.pages), 6)
        permissions = reader.user_access_permissions
        self.assertTrue(bool(permissions & UserAccessPermissions.PRINT))
        self.assertFalse(bool(permissions & UserAccessPermissions.MODIFY))


if __name__ == "__main__":
    unittest.main()
