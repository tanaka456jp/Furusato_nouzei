"""Guard the frozen, reviewed v3 source workbook against unnoticed replacements.

Any intentional source revision requires a reviewed PR that updates the pinned SHA,
independent tax checks, release notes and expected-value tests together.
"""
from hashlib import sha256
from pathlib import Path
import sys

EXPECTED = "e86912bb93ebfbb95803c5c2d0059a7f46b26d19f879bf208442dd152536a05e"
BASELINE = Path(__file__).resolve().parents[1] / "workbook" / "baseline.xlsx"

def main():
    if not BASELINE.exists():
        raise SystemExit("FAIL: frozen source workbook is missing")
    actual = sha256(BASELINE.read_bytes()).hexdigest()
    if actual != EXPECTED:
        raise SystemExit(
            "FAIL: frozen workbook changed without an explicit review. "
            "Expected SHA-256 " + EXPECTED + "; got " + actual
        )
    print("PASS: frozen source workbook SHA-256 " + actual)

if __name__ == "__main__":
    main()
