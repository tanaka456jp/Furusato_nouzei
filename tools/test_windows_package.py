"""Ensure the Windows review bundle needs no user-side Python."""
import sys
from pathlib import Path
from zipfile import ZipFile

def verify(path):
    with ZipFile(path) as z:
        names=set(z.namelist())
        mandatory={"Furusato_nouzei.xlsx","START_SETUP.cmd","setup.ps1",
                   "TaxLawUpdater.bas","BatchWithholding.bas",
                   "FurusatoDocumentReader.exe","README.txt",
                   "PRIVATE_5PAGE_CHECK.cmd","private_batch_excel_acceptance.ps1",
                   "PRIVATE_5PERSON_ORACLE_CHECK.cmd",
                   "private_5person_oracle_acceptance.ps1"}
        assert names==mandatory,(names,mandatory)
        assert z.testzip() is None
        assert len(z.read("FurusatoDocumentReader.exe"))>10000
        assert b"python.exe" not in z.read("TaxLawUpdater.bas").lower()
        assert b"FurusatoDocumentReader.exe" in z.read("TaxLawUpdater.bas")
        assert b"FurusatoDocumentReader.exe" in z.read("BatchWithholding.bas")
        assert b"BatchCalculate" in z.read("BatchWithholding.bas")
        assert b"BatchImportLocalFile" in z.read("BatchWithholding.bas")
        assert b"BatchImportLocalFile" in z.read("private_batch_excel_acceptance.ps1")
        assert z.read("PRIVATE_5PAGE_CHECK.cmd").isascii()
        assert b"ExpectedPages 5" in z.read("PRIVATE_5PAGE_CHECK.cmd")
        # Windows PowerShell 5.1 requires UTF-8 BOM to parse Japanese text
        # without corrupting quoted strings, even on an English runner.
        assert z.read("private_batch_excel_acceptance.ps1").startswith(b"\xef\xbb\xbf")
        private = z.read("private_5person_oracle_acceptance.ps1")
        launcher = z.read("PRIVATE_5PERSON_ORACLE_CHECK.cmd")
        assert private.startswith(b"\xef\xbb\xbf")
        assert launcher.isascii()
        assert b"BatchImportLocalFile" in private
        assert b"BatchCalculateForTest" in private
        assert b"ESTIMATE_DIFFERENCE" in private
        assert b"SAFE_HOLD" in private
        assert b"QaAssumeNoOutsideIncome" in private
        assert b"expect_hold_reason" in private
        assert b"HOLD_REASON_MISMATCH" in private
        assert b"PRIVATE_INPUT_CHANGED" in private
        assert b"ORACLE_COLUMN_MISSING" in private
        assert b"source-field-reconciliation-page-" in private
        assert private.count(b"finally {") == 1
        assert private.count(b"exit 0") == 1
        assert b"private_5person_oracle.csv" in launcher
        assert b"-QaAssumeNoOutsideIncome" in launcher
        assert "private_5person_oracle.csv" not in names
        assert b"121000" not in private and b"105000" not in private

    print("Python-free Windows review bundle: PASS")

if __name__=="__main__":
    verify(Path(sys.argv[1]))
