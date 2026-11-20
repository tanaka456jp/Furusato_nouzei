"""Smoke the exact PyInstaller EXE for the offline edited-batch TSV flow.

Only generated fake numbers/names; no client PDF or personal information.
"""
import csv
import errno
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from batch_manual_edit import INPUT_COLUMNS
from test_batch_manual_edit import data_row, source


def main(exe):
    exe = Path(exe).resolve()
    assert exe.is_file(), "EXE_MISSING"
    with TemporaryDirectory(prefix="synthetic_batch_reader_") as folder:
        infile = Path(folder) / "input.tsv"
        outfile = Path(folder) / "output.tsv"
        rows = [data_row(1, source()), data_row(2, source(mortgage=True))]
        with infile.open("w", encoding="ascii", newline="") as handle:
            w = csv.DictWriter(handle, fieldnames=INPUT_COLUMNS,
                               delimiter="\t", lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
        try:
            run = subprocess.run([str(exe), "--batch-recalculate",
                                  "--input", str(infile), "--output", str(outfile)],
                                 capture_output=True, text=True, timeout=60)
        except OSError as exc:
            # Python traceback exposes real Windows user profile paths.
            if getattr(exc, "winerror", None) == 5 or exc.errno == errno.EACCES:
                raise SystemExit("READER_EXE_LAUNCH_ACCESS_DENIED") from None
            raise SystemExit("READER_EXE_LAUNCH_OS_ERROR") from None
        except subprocess.TimeoutExpired:
            raise SystemExit("READER_EXE_LAUNCH_TIMEOUT") from None
        if run.returncode != 0:
            # Never print stdout/stderr of an untrusted executable.
            raise SystemExit("READER_EXE_BATCH_RECALC_NONZERO_EXIT")
        assert "BATCH_RECALCULATED_PROVISIONAL" in run.stdout, "EXE_MARKER_MISSING"
        with outfile.open("r", encoding="ascii", newline="") as handle:
            output = list(csv.DictReader(handle, delimiter="\t"))
        assert len(output) == 2, "EXE_BATCH_ROW_COUNT"
        assert all(r["TOTAL_DEDUCTIONS"] == "1670000" for r in output), "EXE_TOTAL"
        assert all(r["STATUS"] == "PROVISIONAL" for r in output), "EXE_SCOPE"
        assert all(r["FILING_LIMIT"] != "" for r in output), "EXE_SECOND_LIMIT"
        assert output[0]["RECIPIENT_NAME_HEX"] != output[1]["RECIPIENT_NAME_HEX"], "EXE_IDENTITY"
    print("EXE_SYNTHETIC_BATCH_RECALC_PASS")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: smoke_batch_recalculate_exe.py EXE")
    main(sys.argv[1])
