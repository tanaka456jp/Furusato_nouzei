#!/usr/bin/env python3
"""Validate synthetic Excel PDF layout; does NOT validate physical printing."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
import fitz  # pymupdf pinned by Windows Excel CI

PDFS = (("FurusatoQA.pdf", 1), ("FurusatoQA_hidden.pdf", 1),
        ("split-result.pdf", 2), ("home-overview.pdf", 1))
SPLIT_PRINT_FIELDS = (
    "住宅の居住開始年", "適用上限反映済残高",
    "住宅控除可能額", "普通配当対象額",
    "適格外国所得税額", "調整国外所得金額",
    "適用条件の確認状態", "住民税の課税自治体",
)


def assert_split_print_source_proof(pdfpath: Path, printed_page_text: str) -> dict:
    """Compare a PDF with the *same* Excel COM export's allowlisted input proof.

    All data in the sidecar is synthetic. The hash binds the proof to the PDF,
    and an 8-field exact schema prevents accidentally exporting other cells.
    This does not prove statutory correctness or actual paper appearance.
    """
    proof_path = pdfpath.with_name("split-result.print-inputs.json")
    if not proof_path.is_file():
        raise AssertionError("Split PDF source proof is missing")
    proof = json.loads(proof_path.read_text(encoding="utf-8-sig"))
    if proof.get("schema") != "furusato-split-pdf-printed-inputs/v1":
        raise AssertionError("Split PDF source proof schema mismatch")
    sha = hashlib.sha256(pdfpath.read_bytes()).hexdigest()
    if proof.get("pdf_sha256", "").lower() != sha:
        raise AssertionError("Split PDF source proof SHA-256 mismatch")
    fields = proof.get("fields")
    if not isinstance(fields, dict) or set(fields) != set(SPLIT_PRINT_FIELDS):
        raise AssertionError("Split PDF source proof must contain exactly eight fields")
    version = proof.get("reviewVersion")
    tax_year = proof.get("taxYear")
    if not isinstance(tax_year, int) or tax_year not in (2025, 2026):
        raise AssertionError("Split PDF source proof tax year is invalid")
    if not isinstance(version, str) or not re.fullmatch(r"v4\.18\.\d+", version):
        raise AssertionError("Split PDF source proof review version is invalid")
    visible = re.sub(r"\s+", "", printed_page_text)
    if version not in visible or f"所得年{tax_year}" not in visible:
        raise AssertionError("Split PDF source proof year/version missing from printed page")
    for label in SPLIT_PRINT_FIELDS:
        value = fields[label]
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise AssertionError(f"Split PDF source proof has invalid type: {label}")
        if isinstance(value, int) and value < 0:
            raise AssertionError(f"Split PDF source proof has negative value: {label}")
        rendered = format(value, ",") if isinstance(value, int) else value
        if not rendered or label not in visible or rendered not in visible:
            raise AssertionError(f"Split PDF lacks printed source field: {label}")
    return {"status": "PASS", "fields_checked": len(fields),
            "pdf_sha256": sha, "source": "synthetic Excel COM input cells"}


def source_proof_self_test() -> None:
    """Prove that tampered PDFs, missing data and changed amounts fail closed."""
    with TemporaryDirectory(prefix="furusato-pdf-proof-") as tmp:
        pdf = Path(tmp) / "split-result.pdf"
        pdf.write_bytes(b"%PDF-synthetic-only-self-test")
        fields = dict(zip(SPLIT_PRINT_FIELDS,
                          (2025, 49928572, 349500, 0, 8000, 0,
                           "照合済", "標準市町村")))
        proof = {"schema": "furusato-split-pdf-printed-inputs/v1",
                 "pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                 "reviewVersion": "v4.18.31", "taxYear": 2026, "fields": fields}
        path = pdf.with_name("split-result.print-inputs.json")
        visible = "所得年 2026 Excel版 v4.18.31 " + " ".join(
            f"{k} {format(v, ',') if isinstance(v, int) else v}"
            for k, v in fields.items())
        path.write_text(json.dumps(proof, ensure_ascii=False), encoding="utf-8")
        if assert_split_print_source_proof(pdf, visible)["fields_checked"] != 8:
            raise AssertionError("Split PDF source proof positive control failed")

        def must_reject(label, text):
            try:
                assert_split_print_source_proof(pdf, text)
            except AssertionError:
                return
            raise AssertionError("Split PDF source proof accepted " + label)

        must_reject("wrong printed amount", visible.replace("49,928,572", "49,928,573"))
        must_reject("missing printed label", visible.replace("普通配当対象額", ""))
        proof["pdf_sha256"] = "0" * 64
        path.write_text(json.dumps(proof, ensure_ascii=False), encoding="utf-8")
        must_reject("wrong PDF hash", visible)
        proof["pdf_sha256"] = hashlib.sha256(pdf.read_bytes()).hexdigest()
        proof["fields"].pop("住宅控除可能額")
        path.write_text(json.dumps(proof, ensure_ascii=False), encoding="utf-8")
        must_reject("missing field", visible)


def assert_no_text_collision(page, context: str) -> int:
    """Reject overlapping readable words instead of only checking paper edges.

    Skip one-character punctuation and require material intersection in
    both axes; ordinary baseline kerning and adjacent lines are tolerated.
    This catches an overfull cell spilling into its neighboring print field.
    """
    words = page.get_text("words")
    for i, left in enumerate(words):
        x0, y0, x1, y1, lhs = left[:5]
        if len(lhs.strip()) < 2:
            continue
        for right in words[i+1:]:
            u0, v0, u1, v1, rhs = right[:5]
            if len(rhs.strip()) < 2:
                continue
            overlap_x = max(0, min(x1, u1) - max(x0, u0))
            overlap_y = max(0, min(y1, v1) - max(y0, v0))
            if (overlap_x > 0.15 * min(x1-x0, u1-u0) and
                    overlap_y > 0.30 * min(y1-y0, v1-v0)):
                raise AssertionError(
                    f"{context}: material text collision between "
                    f"{lhs[:20]!r} and {rhs[:20]!r}"
                )
    return len(words)


def collision_self_test() -> None:
    """Ensure the checker catches a collision and accepts separated words."""
    with fitz.open() as fixture:
        page = fixture.new_page(width=595.2, height=841.68)
        page.insert_text((60, 60), "FIRST")
        page.insert_text((320, 70), "SEPARATE")
        assert_no_text_collision(page, "nonoverlap control")
        page.insert_text((64, 61), "OVERLAP")
        try:
            assert_no_text_collision(page, "collision control")
        except AssertionError as exc:
            if "material text collision" not in str(exc):
                raise
        else:
            raise AssertionError("Text-collision detector failed its self-test")


def audit(pdfpath: Path, expected_pages: int, out: Path) -> dict:
    if not pdfpath.is_file() or pdfpath.stat().st_size < 500:
        raise AssertionError("Missing synthetic PDF " + pdfpath.name)
    pages = []
    print_proof = None
    with fitz.open(pdfpath) as doc:
        if doc.needs_pass or len(doc) != expected_pages:
            raise AssertionError(f"{pdfpath.name}: expected {expected_pages} unencrypted pages")
        for i, page in enumerate(doc):
            w, h = page.rect.width, page.rect.height
            if not (590 <= w <= 600 and 835 <= h <= 850):
                raise AssertionError(f"{pdfpath.name}: page {i+1} is not A4 portrait")
            blocks = [b for b in page.get_text("blocks") if len(b) > 6 and b[6] == 0]
            visible = "".join(str(b[4]) for b in blocks).strip()
            if len(visible) < 15:
                raise AssertionError(f"{pdfpath.name}: page {i+1} lacks extractable text")
            for b in blocks:
                x0, y0, x1, y1 = map(float, b[:4])
                if x0 < -2 or y0 < -2 or x1 > w+2 or y1 > h+2:
                    raise AssertionError(f"{pdfpath.name}: text exceeds paper bounds")
            checked_words = assert_no_text_collision(page, f"{pdfpath.name} page {i+1}")
            filename = pdfpath.stem + f"_page{i+1}.png"
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(out / filename)
            pages.append({"page": i+1, "size_pt": [round(w, 2), round(h, 2)],
                          "text_blocks": len(blocks), "words_checked": checked_words, "png": filename})
        if pdfpath.name == "split-result.pdf":
            print_proof = assert_split_print_source_proof(
                pdfpath, doc[1].get_text(sort=True))
            # The synthetic total-income allocation is a single numeric
            # pair. Material text-collision tests do not catch a line wrap,
            # which can visually interleave the next Excel report row.
            first_page_lines = [
                re.sub(r"\s+", "", line)
                for line in doc[0].get_text(sort=True).splitlines()
            ]
            if not any("1,000,000／850,000" in line for line in first_page_lines):
                raise AssertionError(
                    "Split PDF allocation wraps to multiple printed lines"
                )
            text = re.sub(r"\s+", "", doc[1].get_text(sort=True))
            for label in ("所得年", "住民税", "税制版",
                          "計算条件の照合", "住宅控除可能額",
                          "適格外国所得税額", "住民税の課税自治体"):
                if label not in text:
                    raise AssertionError("Split PDF page two lacks: " + label)
        if pdfpath.name == "home-overview.pdf":
            text = re.sub(r"\s+", "", doc[0].get_text(sort=True))
            for label in ("ふるさと納税", "109,000", "2026"):
                if label not in text:
                    raise AssertionError("Home PDF has missing visible label/amount: " + label)
    return {"pdf": pdfpath.name, "pages": pages, "source_proof": print_proof}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()
    collision_self_test()
    source_proof_self_test()
    folder = args.folder.resolve(strict=True)
    source = args.source.read_text(encoding="utf-8-sig")
    version_match = re.search(r"v4\.18\.\d+ 分離課税検証版", source)
    if not version_match:
        raise AssertionError("Workbook revision not identifiable")
    version = version_match.group(0).split()[0]
    reports = [audit(folder / filename, count, folder) for filename, count in PDFS]
    with fitz.open(folder / "split-result.pdf") as doc:
        page2 = re.sub(r"\s+", "", doc[1].get_text(sort=True))
    if version not in page2:
        raise AssertionError("Split PDF second-page version mismatch: " + version)
    with fitz.open(folder / "home-overview.pdf") as doc:
        home_text = re.sub(r"\s+", "", doc[0].get_text(sort=True))
    if version not in home_text:
        raise AssertionError("Home PDF review version mismatch: " + version)
    report = {"status": "PASS", "revision": version, "pdfs": reports,
              "physical_printer_tested": False, "desktop_screens_tested": False,
              "text_collision_self_test": "PASS",
              "split_print_source_proof": "PASS"}
    output = folder / "audit.json"
    if output.exists():
        raise AssertionError("Refusing PDF evidence overwrite")
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("PDF_LAYOUT_PASS: A4 1+1+2+1 pages, eight printed inputs, no text overlap, PNG evidence")
    print("PHYSICAL_PRINTER_AND_DESKTOP_SCREENSHOTS_HOLD")


if __name__ == "__main__":
    main()
