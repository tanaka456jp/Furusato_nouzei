"""Package the development-only workbook and matching Windows build inputs."""
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED

from build_workbook import ROOT, build


def package(destination):
    with TemporaryDirectory() as work:
        workbook = Path(work) / "Furusato_nouzei.xlsx"
        build(ROOT / "workbook/baseline.xlsx", workbook)
        files = {
            "Furusato_nouzei.xlsx": workbook,
            "START_SETUP.cmd": ROOT / "tools/START_SETUP.cmd",
            "setup.ps1": ROOT / "tools/setup.ps1",
            "TaxLawUpdater.bas": ROOT / "vba/TaxLawUpdater.bas",
            "README.txt": ROOT / "docs/user-guide.md",
        }
        with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
            for name, source in files.items():
                archive.write(source, name)
        with ZipFile(destination) as archive:
            assert archive.testzip() is None
            assert set(archive.namelist()) == files.keys()
            assert all(archive.read(name) == source.read_bytes() for name, source in files.items())


if __name__ == "__main__":
    package(Path(sys.argv[1]))
