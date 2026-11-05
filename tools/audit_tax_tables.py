"""Independent read-only tax master audit; no Excel engine or third-party libraries."""
from collections import defaultdict
from pathlib import Path
import posixpath
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile

N = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
COUNTS = {
    "年度別基礎控除": (9, 9), "年度別人的控除": (11, 11),
    "年度別特定親族": (11, 11), "年度別配偶者控除": (66, 66),
    "年度別保険料計算": (16, 20), "年度別控除上限": (1, 1),
    "年度別所得税率": (7, 7), "年度別給与控除": (5, 5),
}
BASIC_LIMITS = (1320000,3360000,4890000,6550000,23500000,24000000,24500000,25000000,999999999999)
BASIC_TAX = {
    2025:(950000,880000,680000,630000,580000,480000,320000,160000,0),
    2026:(1040000,1040000,1040000,670000,620000,480000,320000,160000,0),
}
BASIC_RES = (430000,430000,430000,430000,430000,430000,290000,150000,0)
RATE_LIMITS = (1950000,3300000,6950000,9000000,18000000,40000000,999999999999)
RATES = (.05,.10,.20,.23,.33,.40,.45)

def audit(file):
    with ZipFile(file) as z:
        assert z.testzip() is None, "Invalid XLSX ZIP"
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            strings = ["".join(x.itertext()) for x in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(N+"si")]
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {r.attrib["Id"]:r.attrib["Target"] for r in rels}
        paths = {}
        for x in wb.findall(".//"+N+"sheets/"+N+"sheet"):
            target = targets[x.attrib[RID]]
            paths[x.attrib["name"]] = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
        assert set(COUNTS)|{"年度パラメータ"} <= set(paths), "Required master missing"
        def rows(name):
            root = ET.fromstring(z.read(paths[name]))
            result = []
            for row in root.findall(".//"+N+"sheetData/"+N+"row"):
                if int(row.attrib["r"]) < 4: continue
                values={}
                for c in row.findall(N+"c"):
                    assert c.find(N+"f") is None, f"Formula in master: {name} {c.attrib['r']}"
                    v,inline = c.find(N+"v"),c.find(N+"is")
                    value = v.text if v is not None else "".join(inline.itertext()) if inline is not None else None
                    if value is None: continue
                    if c.attrib.get("t")=="s":value=strings[int(value)]
                    elif c.attrib.get("t") not in ("inlineStr","str","b","e"):
                        try:
                            numeric=float(value)
                            value=int(numeric) if numeric.is_integer() else numeric
                        except ValueError:pass
                    col="".join(a for a in c.attrib["r"] if a.isalpha())
                    values[col]=value
                if values:result.append(values)
            return result
        tables={name:rows(name) for name in set(COUNTS)|{"年度パラメータ"}}
        years={int(r["A"]):r for r in tables["年度パラメータ"] if isinstance(r.get("A"),(int,float))}
        assert set(years)=={2025,2026,2027}, "Unreviewed year detected"
        assert all(years[y]["B"]=="承認済" and years[y]["C"]==y+1 for y in (2025,2026))
        assert years[2027]["B"]!="承認済", "2027 must remain unapproved"
        for name,counts in COUNTS.items():
            by=defaultdict(list)
            for row in tables[name]:
                if isinstance(row.get("A"),(int,float)):by[int(row["A"])].append(row)
            assert set(by)=={2025,2026}, f"{name}: unsupported year {set(by)}"
            for y,n in zip((2025,2026),counts):
                assert len(by[y])==n, f"{name} {y}: expected {n} rows, got {len(by[y])}"
        for year in (2025,2026):
            base=[r for r in tables["年度別基礎控除"] if r.get("A")==year]
            prior=-1
            for i,row in enumerate(base):
                assert (row["B"],row["C"],row["D"],row["E"]) == (prior,BASIC_LIMITS[i],BASIC_TAX[year][i],BASIC_RES[i]), f"{year} basic deduction band {i}"
                prior=row["C"]
            rate=[r for r in tables["年度別所得税率"] if r.get("A")==year]
            prior=-1
            for i,row in enumerate(rate):
                assert row["B"]==prior and row["C"]==RATE_LIMITS[i] and abs(row["D"]-RATES[i])<1e-10, f"{year} marginal rate band {i}"
                prior=row["C"]
        caps={int(r["A"]):r for r in tables["年度別控除上限"]}
        assert caps[2025]["J"]==40000 and caps[2026]["J"]==60000, "Under-23 insurance cap mismatch"
    print(f"PASS: {Path(file).name} 2025/26 master coverage, tax rates, band continuity, 2027 fail-closed")

if __name__=="__main__":
    if len(sys.argv)<2: raise SystemExit("Usage: audit_tax_tables.py workbook.xlsx [...]")
    for arg in sys.argv[1:]: audit(arg)
