"""Assemble an immutable pre-publication candidate from already-signed inputs.

Does NOT sign binaries or publish. Signature and private tax/display reviews
must be separately verified before any release or physical print.
"""
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from release_candidate_branding import verify_workbook_labels, verify_release_readme

def digest(content):
    return hashlib.sha256(content).hexdigest()

def assemble(book, reader, readme, target, version, head_sha):
    paths=[Path(p) for p in (book, reader, readme)]
    dest=Path(target)
    root=Path(__file__).resolve().parents[1]
    actual=dest.resolve()
    if actual==root or root in actual.parents:
        raise ValueError("CANDIDATE_MUST_BE_OUTSIDE_PUBLIC_REPO")
    if dest.exists() or len({p.resolve() for p in paths+[dest]})!=4:
        raise ValueError("CANDIDATE_OVERWRITE_OR_COLLISION")
    if [p.name for p in paths] != ["Furusato_nouzei.xlsm", "FurusatoDocumentReader.exe", "README.txt"]:
        raise ValueError("WRONG_RELEASE_MEMBER_NAMES")
    sizes=[p.stat().st_size for p in paths]
    if not 100000 <= sizes[0] <= 100000000 or not 10000 <= sizes[1] <= 120000000 or not 0 < sizes[2] <= 1048576:
        raise ValueError("INVALID_RELEASE_MEMBER_SIZE")
    book_content=paths[0].read_bytes()
    readme_content=paths[2].read_bytes()
    verify_workbook_labels(book_content,version)
    verify_release_readme(readme_content,version,head_sha)
    dest.parent.mkdir(parents=True,exist_ok=True)
    try:
        with ZipFile(dest,"x",ZIP_DEFLATED,compresslevel=6) as z:
            for p in paths:
                z.write(p,p.name)
        with ZipFile(dest) as z:
            if len(z.infolist())!=3 or z.testzip() is not None:
                raise ValueError("RELEASE_PACKAGE_CRC_OR_CONTENT_INVALID")
            for p in paths:
                if digest(z.read(p.name)) != digest(p.read_bytes()):
                    raise ValueError("RELEASE_PACKAGE_MEMBER_HASH_MISMATCH")
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    return hashlib.sha256(dest.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    for name in ("book","reader","readme","target"):
        ap.add_argument("--"+name,required=True,type=Path)
    ap.add_argument("--version",required=True)
    ap.add_argument("--head",required=True)
    a=ap.parse_args()
    h=assemble(a.book,a.reader,a.readme,a.target,a.version,a.head)
    print("CANDIDATE_ARCHIVE_SHA256="+h+" RELEASE_HOLD_SIGNATURE_AND_HUMAN_REVIEWS_NOT_VERIFIED")

if __name__=="__main__":
    main()
