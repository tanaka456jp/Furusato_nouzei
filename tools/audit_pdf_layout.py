#!/usr/bin/env python3
"""Validate synthetic Excel PDF layout; does NOT validate physical printing."""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path
import fitz  # pymupdf pinned by Windows Excel CI

PDFS = (("FurusatoQA.pdf", 1), ("FurusatoQA_hidden.pdf", 1),
        ("split-result.pdf", 2), ("home-overview.pdf", 1))


def audit(pdfpath: Path, expected_pages: int, out: Path) -> dict:
    if not pdfpath.is_file() or pdfpath.stat().st_size < 500:
        raise AssertionError("Missing synthetic PDF " + pdfpath.name)
    pages = []
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
            filename = pdfpath.stem + f"_page{i+1}.png"
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(out / filename)
            pages.append({"page": i+1, "size_pt": [round(w, 2), round(h, 2)],
                          "text_blocks": len(blocks), "png": filename})
        if pdfpath.name == "split-result.pdf":
            text = re.sub(r"\s+", "", doc[1].get_text(sort=True))
            for label in ("所得年", "住民税", "税制版"):
                if label not in text:
                    raise AssertionError("Split PDF page two lacks: " + label)
        if pdfpath.name == "home-overview.pdf":
            text = re.sub(r"\s+", "", doc[0].get_text(sort=True))
            for label in ("ふるさと納税", "109,000", "2026"):
                if label not in text:
                    raise AssertionError("Home PDF has missing visible label/amount: " + label)
    return {"pdf": pdfpath.name, "pages": pages}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", required=True, type=Path)
    parser.add_argument("--source", required=True, type=Path)
    args = parser.parse_args()
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
              "physical_printer_tested": False, "desktop_screens_tested": False}
    output = folder / "audit.json"
    if output.exists():
        raise AssertionError("Refusing PDF evidence overwrite")
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("PDF_LAYOUT_PASS: synthetic A4 1+1+2+1 pages, printed header, PNG evidence")
    print("PHYSICAL_PRINTER_AND_DESKTOP_SCREENSHOTS_HOLD")


if __name__ == "__main__":
    main()
