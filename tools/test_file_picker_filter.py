"""The default GetOpenFilename filter must show PDF, not hide it."""
from pathlib import Path
import re
vba=(Path(__file__).resolve().parents[1]/"vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
i=vba.index("    picked = Application.GetOpenFilename(")
j=vba.index("    If VarType(picked) =",i)
code=vba[i:j]
strings=re.findall(r'"([^"]+)"',code)
filter_text="".join(strings[:-1])
parts=filter_text.split(",")
assert len(parts)%2==0
pairs=list(zip(parts[::2],parts[1::2]))
assert pairs[0]==("PDF (*.pdf)","*.pdf"),pairs[0]
assert '1, "源泉徴収票を選択"' in code
assert pairs[-1][1]=="*.*"
assert ";" not in filter_text
assert len(filter_text)<255,len(filter_text)
assert {ext for _,ext in pairs}>={"*.pdf","*.png","*.jpg","*.csv","*.json"}
print("PDF picker: PASS")
