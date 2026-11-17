"""Release candidate branding audit without executing workbook macros.

The signed workbook must advertise exactly the intended release version.
Signature validity itself is separately verified by real Windows/Office.
"""
import io
import re
from zipfile import BadZipFile, ZipFile
from openpyxl import load_workbook

VERSION = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+\Z")
BLOCKED = ("検証版", "正式配布HOLD", "NOT FOR PUBLIC DISTRIBUTION")

def verify_workbook_labels(workbook_bytes, version):
    if not isinstance(version, str) or VERSION.fullmatch(version) is None:
        raise ValueError("INVALID_WORKBOOK_CANDIDATE_VERSION")
    if not isinstance(workbook_bytes, bytes) or len(workbook_bytes) > 110000000:
        raise ValueError("INVALID_RELEASE_WORKBOOK_BYTES")
    try:
        with ZipFile(io.BytesIO(workbook_bytes)) as contents:
            parts = contents.infolist()
            if (len(parts) > 5000 or
                any(p.file_size > 110000000 for p in parts) or
                sum(p.file_size for p in parts) > 200000000 or
                contents.testzip() is not None):
                raise ValueError("UNSAFE_RELEASE_XLSM_INTERNAL_PACKAGE")
        book = load_workbook(io.BytesIO(workbook_bytes), read_only=True,
                             data_only=False, keep_links=False)
        try:
            if "操作画面" not in book.sheetnames or "住宅確申寄附検算" not in book.sheetnames:
                raise ValueError("RELEASE_WORKBOOK_REQUIRED_SHEETS_MISSING")
            home = book["操作画面"]["A1"].value
            mortgage = book["住宅確申寄附検算"]["A1"].value
            if (not isinstance(home, str) or not isinstance(mortgage, str)
                    or not home.startswith("ふるさと納税 寄附限度額試算")
                    or not re.search(r"v[0-9]+\.[0-9]+\.[0-9]+", home)
                    or home.count(version) != 1
                    or not mortgage.startswith("確定申告・住宅ローン控除併用")
                    or any(marker in item for item in (home, mortgage)
                           for marker in BLOCKED)):
                raise ValueError("RELEASE_WORKBOOK_VERSION_OR_REVIEW_BRANDING_INVALID")
        finally:
            book.close()
    except (BadZipFile, OSError, ValueError, KeyError, IndexError,
            TypeError, EOFError) as exc:
        if isinstance(exc, ValueError):
            raise
        raise ValueError("INVALID_RELEASE_WORKBOOK_STRUCTURE") from exc
    return True

def verify_release_readme(readme, version):
    if not isinstance(readme, bytes) or not 0 < len(readme) <= 1048576:
        raise ValueError("INVALID_RELEASE_README")
    try:
        source = readme.decode("utf-8-sig")
    except UnicodeError as exc:
        raise ValueError("RELEASE_README_NOT_UTF8") from exc
    if (not source.startswith("# ふるさと納税 寄附限度額試算 " + version + "\n")
            or not all(year in source for year in ("2025", "2026"))
            or not all(word in source for word in ("署名", "税額"))
            or "v4.18.2" in source
            or any(marker in source for marker in BLOCKED)):
        raise ValueError("RELEASE_README_VERSION_OR_SCOPE_INVALID")
    return True
