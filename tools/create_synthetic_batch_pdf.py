"""Generate an entirely fictional 5-page tax slip PDF for LOCAL CI only.

No taxpayer names, addresses, employer identifiers, real source PDF, or
real-world financial statements. Synthetic numbers verify structural I/O,
not legal correctness or actual-source OCR accuracy.
"""
import argparse
from pathlib import Path
import fitz


def make(destination):
    pdf = fitz.open()
    fake_cases = (
        (7100000, 5230000, 1700000, 260000, 900000),
        (5200000, 3710000, 1400000, 140000, 780000),
        (4300000, 3020000, 1280000, 55000, 660000),
        (2100000, 1300000, 950000, 0, None),
        (4800000, 3410000, 1200000, 110000, 710000),
    )
    for ordinal, numbers in enumerate(fake_cases, 1):
        page = pdf.new_page(width=650, height=500)
        page.insert_text((45, 46), "令和 7 年分 源泉徴収票",
                         fontname="japan", fontsize=12)
        page.insert_text((45, 65),
                         "架空の5ページPDFテスト専用・実在の納税者情報なし",
                         fontname="japan", fontsize=9)
        for idx, (field, amount) in enumerate(zip(
            ("G04", "G05", "G06", "G08", "G26"), numbers
        )):
            if amount is None:
                continue
            y = 110 + 52 * idx
            page.insert_text((48, y), field, fontname="helv", fontsize=12)
            page.insert_text((100, y), f"{amount:,}",
                             fontname="helv", fontsize=12)
        # Real (non-identifying) structure of the 2025/26 family-count
        # row. Code slots are required before "empty" can mean zero.
        for idx, code in enumerate((
            "G09","G10","G11","G12","G13","G14","G15","G16",
            "G17","G18","G19","G20","G21","G22","G23","G24"
        )):
            x = 15 + 39 * idx
            value = 2 if code in ("G09","G10","G11") else 0
            page.insert_text((x, 411), code, fontname="helv", fontsize=8)
            page.insert_text((x+23, 411), str(value),
                             fontname="helv", fontsize=8)
        page.insert_text((45, 455), f"SYNTHETIC_TEST_PAGE_{ordinal}",
                         fontname="helv", fontsize=10)
    destination = Path(destination)
    if destination.exists():
        raise ValueError("Refusing to overwrite existing fixture")
    pdf.save(str(destination))
    pdf.close()
    print("SYNTHETIC_FIVE_PAGE_PDF_OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    make(args.destination)
