"""Check the modules and native libraries embedded in the frozen reader."""

import sys
from pathlib import Path, PurePosixPath

from PyInstaller.archive.readers import CArchiveReader


def verify_reader_runtime(executable):
    archive = CArchiveReader(str(executable))
    binaries = {PurePosixPath(name.replace("\\", "/")).name.lower() for name in archive.toc}
    pyz = [name for name, entry in archive.toc.items() if entry[-1] == "z"]
    if len(pyz) != 1 or "pdfium.dll" not in binaries:
        raise ValueError("READER_PDFIUM_RUNTIME_MISSING")
    modules = archive.open_embedded_archive(pyz[0]).toc
    if "pypdfium2" not in modules or "pypdfium2_raw" not in modules:
        raise ValueError("READER_PDFIUM_MODULES_MISSING")
    excluded = {"fitz", "pymupdf", "pillow_heif"}
    if excluded & {name.split(".", 1)[0].lower() for name in modules} or any(
            "mupdf" in name or "pillow_heif" in name for name in binaries):
        raise ValueError("READER_EXCLUDED_DEPENDENCY_PRESENT")


if __name__ == "__main__":
    verify_reader_runtime(Path(sys.argv[1]))
    print("READER_EMBEDDED_RUNTIME_AND_EXCLUSIONS_PASS")
