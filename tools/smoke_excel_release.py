"""Smoke-test the candidate ZIP from a Japanese path using the bundled reader."""

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile

from record_ci_acceptance import digest_file
from release_readiness import RELEASE_ZIP, read_evidence, require, validate_candidate_report
from verify_excel_release_candidate import verify_distribution


def smoke(bundle):
    candidate = read_evidence(bundle / "candidate.json")
    head, run_id, attempt = (candidate[key] for key in ("head_sha", "run_id", "run_attempt"))
    validate_candidate_report(candidate, head, run_id, attempt)
    archive = bundle / RELEASE_ZIP
    checked = verify_distribution(
        archive, head, candidate["version"], candidate["workbook_sha256"],
        candidate["reader_sha256"], candidate["signing_state"], candidate["signing_evidence"])
    require(all(candidate.get(k) == value for k, value in checked.items()),
            "RELEASE_SMOKE_ARCHIVE_HASH_MISMATCH")
    with tempfile.TemporaryDirectory(prefix="furusato-release-") as folder:
        path = Path(folder) / "試験用"
        path.mkdir()
        with ZipFile(archive) as zipped:
            for name, expected in (("Furusato_nouzei.xlsm", checked["workbook_sha256"]),
                                   ("FurusatoDocumentReader.exe", checked["reader_sha256"]),
                                   ("README.txt", checked["readme_sha256"])):
                with zipped.open(name) as source, (path / name).open("xb") as dest:
                    shutil.copyfileobj(source, dest)
                require(digest_file(path / name) == expected, "RELEASE_SMOKE_EXTRACTION_SHA_MISMATCH")
        sample, output = path / "anonymous.csv", path / "result.json"
        sample.write_text(
            "field,value\nyear,2026\nsalary_gross,7000000\nsocial_insurance,1000000\n"
            "income_tax_withheld,0\n", encoding="ascii")
        process = subprocess.run([str(path / "FurusatoDocumentReader.exe"),
                                  "--input", str(sample), "--output", str(output)],
                                 capture_output=True, timeout=90, check=False, cwd=path)
        require(process.returncode == 0, "RELEASE_SMOKE_OFFLINE_READER_FAILED")
        result = read_evidence(output)
        require(result.get("status") == "READY_FOR_EXCEL_CROSSCHECK"
                and result.get("fields", {}).get("salary_gross") == 7_000_000,
                "RELEASE_SMOKE_OFFLINE_READER_VALUE_MISMATCH")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    a = parser.parse_args()
    try:
        smoke(a.bundle.resolve())
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        print("WINDOWS_RELEASE_ZIP_SMOKE_HOLD",
              str(error) if type(error) is ValueError else type(error).__name__)
        return 2
    print("WINDOWS_RELEASE_ZIP_EXTRACTION_AND_OFFLINE_READER_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
