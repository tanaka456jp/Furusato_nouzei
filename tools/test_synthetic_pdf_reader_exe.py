"""Validate the REAL Windows reader EXE against a fictional five-page PDF.

Runs on a hosted Windows runner. No private slips or financial information.
"""
import csv
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from create_synthetic_batch_pdf import make


def test(executable):
    with TemporaryDirectory() as folder:
        base = Path(folder)
        pdf = base / "fictional_five_pages.pdf"
        output = base / "fictional_result.json"
        bridge = base / "fictional_batch.tsv"
        make(pdf)
        ran = subprocess.run(
            [str(Path(executable).resolve()), "--input", str(pdf),
             "--output", str(output), "--batch-bridge", str(bridge)],
            check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=90,
        )
        if ran.returncode != 0 or not bridge.is_file():
            raise AssertionError("Synthetic PDF reader executable failed")
        with bridge.open("r", encoding="ascii", newline="") as handle:
            rows = list(csv.reader(handle, delimiter="\t"))
        pages = []
        current = None
        for row in rows:
            if len(row) != 2:
                raise AssertionError("Corrupted batch bridge row")
            name, value = row
            if name == "PAGE":
                if current is not None:
                    raise AssertionError("Overlapping pages")
                current = {"page": int(value), "fields": set()}
            elif name == "ENDPAGE":
                if current is None or int(value) != current["page"]:
                    raise AssertionError("Wrong page terminator")
                pages.append(current)
                current = None
            else:
                if current is None:
                    raise AssertionError("Unscoped field")
                if name in {"STATUS", "YEAR", "WARNINGS"}:
                    current[name] = value
                else:
                    current["fields"].add(name)
        if current is not None or len(pages) != 5:
            raise AssertionError("Wrong page count")
        for idx, page in enumerate(pages, 1):
            if page["page"] != idx or page["YEAR"] != "2025":
                raise AssertionError("Cross-page year/ordinal contamination")
            status = "REQUIRES_REVIEW" if idx == 4 else "READY_FOR_EXCEL_CROSSCHECK"
            if page["STATUS"] != status:
                raise AssertionError("Incorrect per-page status")
            if (("social_insurance" in page["fields"]) != (idx != 4)):
                raise AssertionError("Missing social field misattributed to a page")
            if not {"salary_gross", "salary_reference",
                    "deductions_reference", "income_tax_withheld"}.issubset(page["fields"]):
                raise AssertionError("Required fiscal fields lost")
        print("SYNTHETIC_FIVE_PAGE_READER_EXE_PASS")


if __name__ == "__main__":
    test(sys.argv[1])
