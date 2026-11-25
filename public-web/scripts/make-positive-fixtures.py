"""Generate ONLY fictional positive/contradictory Japanese QA documents.
No real form, personal data, source file input, or external OCR service.
Requires PyMuPDF and fonttools; the font is embedded as a document subset.
"""
import argparse
from pathlib import Path
import tempfile
import fitz
from fontTools import subset
from fontTools.ttLib import TTFont

LABELS = ["支払金額", "給与所得控除後の金額", "所得控除の額の合計額", "社会保険料等の金額"]
AMOUNTS = ["7,000,000", "5,200,000", "1,670,000", "1,000,000"]
MARK = "架空の試験用資料　提出・申告には使用不可"
TITLE = "給与所得の源泉徴収票"
YEAR = "令和8年分"

def make_page(doc, font, bad=False):
    p = doc.new_page(width=595, height=842)
    p.insert_font(fontname="jpn", fontfile=str(font))
    def txt(x, y, text, size=14):
        p.insert_text((x, y), text, fontname="jpn", fontsize=size)
    txt(42, 42, MARK, 16)
    txt(42, 93, YEAR, 16)
    txt(42, 122, TITLE, 20)
    for i, (label, amount) in enumerate(zip(LABELS, AMOUNTS)):
        y = 190 + i * 125
        p.draw_rect(fitz.Rect(35, y-25, 560, y+50), color=(.3,.3,.3))
        txt(50, y, label, 16)
        txt(66, y+25, amount, 20)
    if bad:
        txt(50, 750, "支払金額", 16)
        txt(66, 775, "8,000,000", 20)
    txt(42, 820, "SYNTHETIC QA ONLY", 12)

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--font", required=True, help="Installed Noto Sans CJK regular TTC")
    args = cli.parse_args()
    dest = Path(__file__).resolve().parent.parent / "qa-fixtures"
    dest.mkdir(exist_ok=True)
    names = ["06-positive-electronic.pdf", "07-positive-mixed-batch.pdf", "08-positive-image.png"]
    if any((dest / n).exists() for n in names):
        raise ValueError("Refuse to overwrite existing QA files")
    with tempfile.TemporaryDirectory() as tmp:
        font = Path(tmp) / "subset.otf"
        with TTFont(args.font, fontNumber=0) as original:
            options = subset.Options()
            # Preserve CID/glyph mapping: compacting GIDs can make visible
            # CFF glyphs disagree with the PDF text layer.
            options.retain_gids = True
            sub = subset.Subsetter(options=options)
            sub.populate(text=MARK+TITLE+YEAR+"".join(LABELS+AMOUNTS)+"8,000,000SYNTHETIC QA ONLY")
            sub.subset(original)
            original.save(font)
        for name, multi in [(names[0], False), (names[1], True)]:
            with fitz.open() as doc:
                make_page(doc, font)
                if multi:
                    make_page(doc, font, bad=True)
                doc.save(dest/name, garbage=4, deflate=True)
        with fitz.open(dest/names[0]) as doc:
            doc[0].get_pixmap(matrix=fitz.Matrix(2,2)).save(dest/names[2])
    for name in names:
        assert 100 < (dest/name).stat().st_size < 8*1024*1024
    print("MOBILE_POSITIVE_FIXTURES_3_CREATED; fictional only")

if __name__ == "__main__":
    main()
