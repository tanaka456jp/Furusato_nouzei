"""Package the development-only workbook and matching Windows build inputs."""
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZIP_DEFLATED

from build_workbook import ROOT, build


def package(destination, reader=None):
    with TemporaryDirectory() as work:
        workbook = Path(work) / "Furusato_nouzei.xlsx"
        build(ROOT / "workbook/baseline.xlsx", workbook)
        files = {
            "Furusato_nouzei.xlsx": workbook,
            "START_SETUP.cmd": ROOT / "tools/START_SETUP.cmd",
            "setup.ps1": ROOT / "tools/setup.ps1",
            "TaxLawUpdater.bas": ROOT / "vba/TaxLawUpdater.bas",
            "BatchWithholding.bas": ROOT / "vba/BatchWithholding.bas",
            "README.txt": ROOT / "docs/user-guide.md",
        }
        if reader is None:
            # Developer review ZIP (not a customer-facing Python-free package).
            files["withholding_reader.py"] = ROOT / "tools/withholding_reader.py"
        else:
            reader = Path(reader)
            if not reader.is_file() or reader.stat().st_size < 10000:
                raise ValueError("Verified standalone Windows reader EXE required")
            files["FurusatoDocumentReader.exe"] = reader
            # Private source acceptance is available only in the actual
            # Python-free Windows bundle, never on public Actions with
            # uploaded tax documents.
            files["PRIVATE_5PAGE_CHECK.cmd"] = ROOT / "tools/PRIVATE_5PAGE_CHECK.cmd"
            files["private_batch_excel_acceptance.ps1"] = (
                ROOT / "tools/private_batch_excel_acceptance.ps1"
            )
            # Private oracle logic ships WITHOUT any confidential fixture.
            files["PRIVATE_5PERSON_ORACLE_CHECK.cmd"] = (
                ROOT / "tools/PRIVATE_5PERSON_ORACLE_CHECK.cmd"
            )
            files["private_5person_oracle_acceptance.ps1"] = (
                ROOT / "tools/private_5person_oracle_acceptance.ps1"
            )
        with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
            for name, source in files.items():
                archive.write(source, name)
        with ZipFile(destination) as archive:
            assert archive.testzip() is None
            assert set(archive.namelist()) == files.keys()
            assert all(archive.read(name) == source.read_bytes() for name, source in files.items())


if __name__ == "__main__":
    package(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv)>2 else None)
