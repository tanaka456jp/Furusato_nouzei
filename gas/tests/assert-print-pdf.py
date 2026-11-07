"""Fail if Chromium exported a blank/wrapper-only or badly paginated report."""
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.qa-python'))
from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
assert len(reader.pages) == 1, 'Standard synthetic report must fit one A4 page'
text = unicodedata.normalize('NFKC', '\n'.join(page.extract_text() for page in reader.pages))
for expected in ['109,000', '7,000,000', '1,000,000', '374,500', '2026', '計算根拠', '限度額']:
    assert expected in text, 'Required report content absent: ' + expected
print('PRINT_PDF_CONTENT_PASS: one A4 page with expected synthetic values')
