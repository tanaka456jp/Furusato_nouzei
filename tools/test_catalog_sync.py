"""Prevent accidental invalidation of the approved online master catalog."""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
catalog=(ROOT/"taxdata/catalog.tsv").read_text(encoding="utf-8")
vba=(ROOT/"vba/TaxLawUpdater.bas").read_text(encoding="utf-8")
builder=(ROOT/"tools/build_workbook.py").read_text(encoding="utf-8")
match=re.search(r'^Private Const BUNDLED_REVISION As String = "([^"]+)"',vba,re.M)
assert match, "Missing VBA approved revision"
revision=match.group(1)
assert f'home["B29"] = "{revision}"' in builder,"Workbook revision differs from VBA"
for year in (2025,2026):
    matching=[line.split("|") for line in catalog.splitlines()
              if line.startswith(str(year)+"|")]
    assert len(matching)==1 and matching[0]==[str(year),"APPROVED",revision,"",""], (
        "Unapproved bundled catalog for",year,revision)
application=re.search(r'ふるさと納税 寄附限度額試算\\s+(v4\\.\\d+\\.\\d+)\\s+検証版',builder)
assert application, "Application version missing or malformed"
assert application.group(1) != revision, "Application and tax-master revision conflated"
print("Catalog/VBA/workbook approved tax-master revisions: PASS")
