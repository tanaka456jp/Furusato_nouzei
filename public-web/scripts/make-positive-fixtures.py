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

def make_page(doc, font, bad=False, amounts=None, year=YEAR, duplicate_year=False, shade=0):
    p = doc.new_page(width=595, height=842)
    p.insert_font(fontname="jpn", fontfile=str(font))
    def txt(x, y, text, size=14):
        p.insert_text((x, y), text, fontname="jpn", fontsize=size, color=(shade, shade, shade))
    txt(42, 42, MARK, 16)
    txt(42, 93, year, 16)
    if duplicate_year:
        txt(300, 93, "令和7年分", 16)
    txt(42, 122, TITLE, 20)
    for i, (label, amount) in enumerate(zip(LABELS, AMOUNTS if amounts is None else amounts)):
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
    names = ["06-positive-electronic.pdf", "07-positive-mixed-batch.pdf", "08-positive-image.png", "09-positive-lines.png"]
    research = [
        ("10-bilingual-varied.png", ["6,431,200", "4,704,960", "1,389,240", "824,600"], "令和7年分", False, False),
        ("11-bilingual-printed-period.png", ["7.000.000", "5,200,000", "1,670,000", "1,000,000"], YEAR, False, False),
        ("12-bilingual-printed-minus.png", ["7,000,000", "5,200,000", "1,670,000", "-1,000,000"], YEAR, False, False),
        ("13-bilingual-duplicate-label.png", AMOUNTS, YEAR, True, False),
        ("14-bilingual-conflicting-year.png", AMOUNTS, YEAR, False, True),
    ]
    extra = ["15-bilingual-jpeg.jpg", "16-bilingual-low-contrast.png", "17-bilingual-raster.pdf",
             "18-bilingual-raster-mixed.pdf", "19-bilingual-previous-year.png"]
    if any((dest / n).exists() for n in names + [v[0] for v in research] + extra):
        raise ValueError("Refuse to overwrite existing QA files")
    with tempfile.TemporaryDirectory() as tmp:
        font = Path(tmp) / "subset.otf"
        with TTFont(args.font, fontNumber=0) as original:
            options = subset.Options()
            # Preserve CID/glyph mapping: compacting GIDs can make visible
            # CFF glyphs disagree with the PDF text layer.
            options.retain_gids = True
            sub = subset.Subsetter(options=options)
            sub.populate(text=MARK+TITLE+YEAR+"".join(LABELS+AMOUNTS)+"8,000,000SYNTHETIC QA ONLY0123456789.-令和7年分")
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
        # A separate, clearly marked same-line positive fixture.
        with fitz.open() as doc:
            p = doc.new_page(width=595, height=600)
            p.insert_font(fontname="jpn", fontfile=str(font))
            lines = [(40,40,MARK,14), (40,90,YEAR,20), (40,130,TITLE,22)]
            lines += [(40,210+i*70,label+" "+amount.replace(",",""),20)
                      for i,(label,amount) in enumerate(zip(LABELS,AMOUNTS))]
            lines += [(40,560,"SYNTHETIC QA ONLY",14)]
            for x,y,text,size in lines:
                p.insert_text((x,y),text,fontname="jpn",fontsize=size)
            p.get_pixmap(matrix=fitz.Matrix(2,2)).save(dest/names[3])
        for name, amounts, year, duplicate_label, duplicate_year in research:
            with fitz.open() as doc:
                make_page(doc, font, bad=duplicate_label, amounts=amounts, year=year, duplicate_year=duplicate_year)
                doc[0].get_pixmap(matrix=fitz.Matrix(2,2)).save(dest/name)
        # Different image encoding/contrast and a tax-consistent prior-year case.
        with fitz.open(dest/names[0]) as doc:
            doc[0].get_pixmap(matrix=fitz.Matrix(1.7,1.7)).save(dest/extra[0], jpg_quality=75)
        with fitz.open() as doc:
            make_page(doc, font, shade=.30)
            doc[0].get_pixmap(matrix=fitz.Matrix(2,2)).save(dest/extra[1])
        with fitz.open() as doc:
            make_page(doc, font, amounts=["5,000,000","3,560,000","1,430,000","750,000"], year="令和7年分")
            doc[0].get_pixmap(matrix=fitz.Matrix(2,2)).save(dest/extra[4])
        # Real image-only PDFs: no hidden or searchable text layer.
        for filename, images in [(extra[2], [names[2]]), (extra[3], [names[2], "11-bilingual-printed-period.png"])]:
            with fitz.open() as doc:
                for image in images:
                    page = doc.new_page(width=595, height=842)
                    page.insert_image(page.rect, filename=str(dest/image))
                    assert not page.get_text().strip()
                doc.save(dest/filename, garbage=4, deflate=True)
    for name in names + [v[0] for v in research] + extra:
        assert 100 < (dest/name).stat().st_size < 8*1024*1024
    print("MOBILE_POSITIVE_FIXTURES_AND_BILINGUAL_FORMATS_CREATED; fictional only")

if __name__ == "__main__":
    main()
