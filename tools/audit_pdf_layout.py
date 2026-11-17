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
EXPECTED_PRINT_RANGES = {
    "home_print_area": "$A$1:$D$39",
    "detail_print_area": "$A$1:$D$23",
}
PDF_SOURCE_FILES = {name for name, _ in PDFS} | {"split-result.print-inputs.json"}
SPLIT_PRINT_FIELDS = (
    "住宅の居住開始年", "適用上限反映済残高",
    "住宅控除可能額", "普通配当対象額",
    "適格外国所得税額", "調整国外所得金額",
    "適用条件の確認状態", "住民税の課税自治体",
)


def formatted_print_value(label: str, value: int | str) -> str:
    # Housing occupancy years use calendar-year formatting, never thousands.
    return (str(value) if label == "住宅の居住開始年" else
            format(value, ",") if isinstance(value, int) else value)


def assert_split_print_row_geometry(words: list, fields: dict) -> None:
    """Verify each printed value is beside its label, on its actual table row.

    PDF-wide text existence alone cannot distinguish one repeated zero from
    another. In this four-row A/B/C/D print table, the value must be in B/D,
    on the same baseline as its own A/C label, below the audit heading.
    """
    heading = [w for w in words if w[4] == "計算条件の照合（入力値の控え）"]
    if len(heading) != 1:
        raise AssertionError("Split PDF proof table heading missing or duplicated")
    table_start = heading[0][3]
    previous_center = None
    for i in range(0, len(SPLIT_PRINT_FIELDS), 2):
        centers = []
        for side, label in (("left", SPLIT_PRINT_FIELDS[i]),
                            ("right", SPLIT_PRINT_FIELDS[i + 1])):
            matching_labels = [
                w for w in words
                if w[4] == label and w[1] > table_start + 1
                and ((w[0] < 295) if side == "left" else (w[0] >= 295))
            ]
            if len(matching_labels) != 1:
                raise AssertionError(f"Split PDF proof label placement: {label}")
            anchor = matching_labels[0]
            center = (anchor[1] + anchor[3]) / 2
            rendered = formatted_print_value(label, fields[label])
            x_min, x_max = (170, 295) if side == "left" else (430, 585)
            matching_values = [
                w for w in words
                if w[4] == rendered and x_min <= w[0] < x_max
                and w[0] >= anchor[2] + 3
                and abs((w[1] + w[3]) / 2 - center) <= 3
            ]
            if len(matching_values) != 1:
                raise AssertionError(f"Split PDF proof value misplaced: {label}")
            centers.append(center)
        if abs(centers[0] - centers[1]) > 3:
            raise AssertionError("Split PDF proof column labels are on different rows")
        if previous_center is not None and centers[0] <= previous_center + 10:
            raise AssertionError("Split PDF proof table row order changed")
        previous_center = centers[0]


def assert_split_print_source_proof(
        pdfpath: Path, printed_page_text: str, printed_words: list) -> dict:
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
        rendered = formatted_print_value(label, value)
        if not rendered or label not in visible or rendered not in visible:
            raise AssertionError(f"Split PDF lacks printed source field: {label}")
    assert_split_print_row_geometry(printed_words, fields)
    return {"status": "PASS", "fields_checked": len(fields),
            "pdf_sha256": sha, "row_geometry": "PASS",
            "source": "synthetic Excel COM input cells"}


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
                 "reviewVersion": "v4.18.32", "taxYear": 2026, "fields": fields}
        path = pdf.with_name("split-result.print-inputs.json")
        visible = "所得年 2026 Excel版 v4.18.32 " + " ".join(
            f"{k} {str(v) if k == '住宅の居住開始年' else format(v, ',') if isinstance(v, int) else v}"
            for k, v in fields.items())
        # Synthetic PDF word positions mirror the generated four-row table.
        # Separate left/right boxes ensure repeated zeroes have independent
        # location checks rather than falsely satisfying each other.
        words = [(26, 170, 206, 182, "計算条件の照合（入力値の控え）")]
        for i in range(0, len(SPLIT_PRINT_FIELDS), 2):
            y = 195 + i // 2 * 29
            for label, lx, vx in (
                    (SPLIT_PRINT_FIELDS[i], 26, 250),
                    (SPLIT_PRINT_FIELDS[i + 1], 306, 520)):
                words.append((lx, y, lx + 110, y + 11, label))
                words.append((vx, y, vx + 25, y + 11,
                              formatted_print_value(label, fields[label])))
        path.write_text(json.dumps(proof, ensure_ascii=False), encoding="utf-8")
        if assert_split_print_source_proof(pdf, visible, words)["fields_checked"] != 8:
            raise AssertionError("Split PDF source proof positive control failed")

        def must_reject(label, text, word_positions=None):
            try:
                assert_split_print_source_proof(
                    pdf, text, words if word_positions is None else word_positions)
            except AssertionError:
                return
            raise AssertionError("Split PDF source proof accepted " + label)

        must_reject("wrong printed amount", visible.replace("49,928,572", "49,928,573"))
        must_reject("wrong occupancy year", visible.replace("住宅の居住開始年 2025", "住宅の居住開始年 2024"))
        must_reject("missing printed label", visible.replace("普通配当対象額", ""))
        displaced = [
            (w[0], w[1] + 16, w[2], w[3] + 16, w[4])
            if w[4] == "49,928,572" else w for w in words
        ]
        must_reject("value moved to wrong row", visible, displaced)
        bad_column = [
            (w[0] - 90, w[1], w[2] - 90, w[3], w[4])
            if w[4] == "照合済" else w for w in words
        ]
        must_reject("value moved out of source column", visible, bad_column)
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
            margins = [
                min(block[0] for block in blocks),
                min(block[1] for block in blocks),
                w - max(block[2] for block in blocks),
                h - max(block[3] for block in blocks),
            ]
            if min(margins) < 14:
                raise AssertionError(f"{pdfpath.name}: readable text is too close to the paper edge")
            font_sizes = [
                span["size"]
                for block in page.get_text("dict")["blocks"] if "lines" in block
                for line in block["lines"]
                for span in line["spans"] if span["text"].strip()
            ]
            if not font_sizes or min(font_sizes) < 8:
                raise AssertionError(f"{pdfpath.name}: printed text under 8 points")
            checked_words = assert_no_text_collision(page, f"{pdfpath.name} page {i+1}")
            filename = pdfpath.stem + f"_page{i+1}.png"
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(out / filename)
            pages.append({"page": i+1, "size_pt": [round(w, 2), round(h, 2)],
                          "text_blocks": len(blocks), "words_checked": checked_words,
                          "text_margins_pt": [round(value, 2) for value in margins],
                          "smallest_text_pt": round(min(font_sizes), 2), "png": filename,
                          "png_sha256": hashlib.sha256((out / filename).read_bytes()).hexdigest()})
        if pdfpath.name == "split-result.pdf":
            print_proof = assert_split_print_source_proof(
                pdfpath, doc[1].get_text(sort=True),
                doc[1].get_text("words", sort=True))
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
            first_page = "".join(first_page_lines)
            for label in ("2026／2027", "120,000", "120,783", "1,718", "412,500", "320,700"):
                if label not in first_page:
                    raise AssertionError("Split PDF first page lacks: " + label)
            text = re.sub(r"\s+", "", doc[1].get_text(sort=True))
            for label in ("所得年", "住民税", "税制版",
                          "計算条件の照合", "住宅控除可能額",
                          "適格外国所得税額", "住民税の課税自治体"):
                if label not in text:
                    raise AssertionError("Split PDF page two lacks: " + label)
        if pdfpath.name == "home-overview.pdf":
            text = re.sub(r"\s+", "", doc[0].get_text(sort=True))
            for label in ("ふるさと納税", "109,000", "374,500", "7,000,000",
                          "5,200,000", "1,000,000", "所得年2026", "住民税課税年度2027"):
                if label not in text:
                    raise AssertionError("Home PDF has missing visible label/amount: " + label)
        if pdfpath.name in ("FurusatoQA.pdf", "FurusatoQA_hidden.pdf"):
            text = re.sub(r"\s+", "", doc[0].get_text(sort=True))
            for label in ("所得年2026", "住民税課税年度2027", "109,000", "374,500", "74,900"):
                if label not in text:
                    raise AssertionError("Detail PDF has missing visible label/amount: " + label)
    return {"pdf": pdfpath.name, "sha256": hashlib.sha256(pdfpath.read_bytes()).hexdigest(),
            "pages": pages, "source_proof": print_proof}


def verify_pdf_source(folder: Path, source_head: str, workbook_sha256: str) -> dict:
    if (not re.fullmatch(r"[0-9a-f]{40}", source_head) or
            not re.fullmatch(r"[0-9a-f]{64}", workbook_sha256)):
        raise AssertionError("Invalid PDF acceptance source HEAD/workbook SHA-256")
    evidence = folder / "pdf_source.json"
    if evidence.is_symlink() or not evidence.is_file() or evidence.stat().st_size > 10_000:
        raise AssertionError("PDF source evidence is missing or unsafe")
    data = json.loads(evidence.read_text(encoding="utf-8-sig"))
    if (not isinstance(data, dict) or
            data.get("schema") != "furusato-excel-pdf-source/v2" or
            data.get("source_head") != source_head or
            data.get("workbook_sha256") != workbook_sha256 or
            any(data.get(key) != expected for key, expected in EXPECTED_PRINT_RANGES.items())):
        raise AssertionError("PDF source build or print area mismatch")
    files = data.get("files")
    if not isinstance(files, dict) or set(files) != PDF_SOURCE_FILES:
        raise AssertionError("PDF source file set mismatch")
    for name, expected_hash in files.items():
        file = folder / name
        if (file.is_symlink() or not file.is_file() or file.stat().st_size > 20_000_000 or
                hashlib.sha256(file.read_bytes()).hexdigest() != expected_hash):
            raise AssertionError("PDF source SHA-256 mismatch: " + name)
    return {key: data[key] for key in EXPECTED_PRINT_RANGES}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--source-head")
    parser.add_argument("--workbook-sha256")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    collision_self_test()
    source_proof_self_test()
    if args.self_test:
        print("PDF_AUDIT_SELF_TEST_PASS: collisions, proof geometry and mutations")
        return
    if not all((args.folder, args.source, args.source_head, args.workbook_sha256)):
        parser.error("--folder, --source, --source-head and --workbook-sha256 are required outside --self-test")
    folder = args.folder.resolve(strict=True)
    output = folder / "audit.json"
    if output.exists() or output.is_symlink():
        raise AssertionError("Refusing PDF evidence overwrite")
    print_ranges = verify_pdf_source(folder, args.source_head, args.workbook_sha256)
    source = args.source.read_text(encoding="utf-8-sig")
    # Read the exact version encoded in the generated Excel header.
    # Do not require a development-only "検証版" badge for a pre-signing candidate.
    version_match = re.search(
        r'bar\(home, 1, "ふるさと納税 寄附限度額試算[ ]+(v4\.18\.\d+)"\)',
        source,
    )
    if not version_match:
        raise AssertionError("Workbook revision not identifiable")
    version = version_match.group(1)
    reports = [audit(folder / filename, count, folder) for filename, count in PDFS]
    with fitz.open(folder / "split-result.pdf") as doc:
        page2 = re.sub(r"\s+", "", doc[1].get_text(sort=True))
    if version not in page2:
        raise AssertionError("Split PDF second-page version mismatch: " + version)
    with fitz.open(folder / "home-overview.pdf") as doc:
        home_text = re.sub(r"\s+", "", doc[0].get_text(sort=True))
    if version not in home_text:
        raise AssertionError("Home PDF review version mismatch: " + version)
    report = {"schema": "furusato-excel-pdf-acceptance/v2", "status": "PASS",
              "source_head": args.source_head, "workbook_sha256": args.workbook_sha256,
              "revision": version, "page_count": sum(len(item["pages"]) for item in reports),
              "print_ranges": print_ranges, "pdfs": reports,
              "physical_printer_tested": False, "desktop_screens_tested": False,
              "text_collision_self_test": "PASS",
              "split_print_source_proof": "PASS",
              "split_print_row_geometry": "PASS"}
    with output.open("x", encoding="utf-8") as result:
        json.dump(report, result, ensure_ascii=False, indent=2)
    print("PDF_LAYOUT_PASS: A4 1+1+2+1 pages, eight printed inputs, no text overlap, PNG evidence")
    print("PHYSICAL_PRINTER_NOT_TESTED")


if __name__ == "__main__":
    main()
