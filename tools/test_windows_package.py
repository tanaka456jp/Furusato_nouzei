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
                   "PRIVATE_5PAGE_CHECK.cmd","private_batch_excel_acceptance.ps1"}
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
    print("Python-free Windows review bundle: PASS")

if __name__=="__main__":
    verify(Path(sys.argv[1]))
