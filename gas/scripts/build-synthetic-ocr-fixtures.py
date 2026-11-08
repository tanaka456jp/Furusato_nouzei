"""Build image-only withholding slip fixtures. Uses no account or customer data."""

import argparse
import io
from pathlib import Path
from zipfile import ZipFile

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def build(font_path):
    width, height = 1240, 1754
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    lines = [
        (100, 42, "合成データ・試験専用"),
        (250, 48, "令和8年分 給与所得の源泉徴収票"),
        (440, 46, "支払金額 7,000,000 円"),
        (555, 46, "社会保険料等の金額 1,000,000 円"),
        (670, 46, "給与所得控除後の金額 5,200,000 円"),
    ]
    for y, size, line in lines:
        font = ImageFont.truetype(str(font_path), size)
        if draw.textlength(line, font=font) > width - 180:
            raise ValueError("Synthetic text does not fit")
        draw.text((90, y), line, font=font, fill="black")

    files = {}
    for extension, image_format in [("png", "PNG"), ("jpeg", "JPEG")]:
        stream = io.BytesIO()
        image.save(stream, format=image_format, quality=95)
        files[extension] = stream.getvalue()
    stream = io.BytesIO()
    pdf = canvas.Canvas(stream, pagesize=A4, invariant=True)
    pdf.drawImage(ImageReader(image), 0, 0, width=A4[0], height=A4[1])
    pdf.showPage()
    pdf.save()
    files["pdf"] = stream.getvalue()
    pages = PdfReader(io.BytesIO(files["pdf"])).pages
    if len(pages) != 1 or pages[0].extract_text().strip() or len(pages[0].images) != 1:
        raise ValueError("PDF must have one raster image and no extractable text")
    if any(len(data) > 2 * 1024 * 1024 for data in files.values()):
        raise ValueError("Synthetic file exceeds the GAS OCR upload limit")
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    files = build(args.font)
    with ZipFile(args.output, "x") as archive:
        for extension, data in files.items():
            archive.writestr(f"synthetic-slip.{extension}", data)
    print("SYNTHETIC_PDF_PNG_JPEG_CREATED; PDF_IMAGE_ONLY=PASS")


if __name__ == "__main__":
    main()
