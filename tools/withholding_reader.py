"""Local-only withholding document reader. Does not transmit or retain identifiers."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import re
import sys

SUPPORTED = {".pdf",".png",".jpg",".jpeg",".webp",".tif",".tiff",".bmp",
             ".heic",".heif",".txt",".csv",".tsv",".json"}
CODE_MAP = {
    "G04":"salary_gross","G05":"salary_reference","G06":"deductions_reference",
    "G08":"income_tax_withheld","G26":"social_insurance",
    "G27":"life_deduction_reference","G28":"earthquake_deduction_reference",
    "G29":"mortgage_credit","G30":"life_new","G31":"life_old",
    "G32":"medical_care","G33":"annuity_new","G34":"annuity_old",
    "G36":"mortgage_possible_credit","G46":"basic_reference",
    "G47":"income_adjustment",
}
TEXT_MAP = {
    "支払金額":"salary_gross", "給与所得控除後の金額":"salary_reference",
    "所得控除の額の合計額":"deductions_reference",
    "源泉徴収税額":"income_tax_withheld", "社会保険料等の金額":"social_insurance",
    "新生命保険料":"life_new", "旧生命保険料":"life_old",
    "新個人年金保険料":"annuity_new", "旧個人年金保険料":"annuity_old",
    "介護医療保険料":"medical_care", "地震保険料の支払額":"earthquake_paid",
    "住宅借入金等特別控除の額":"mortgage_credit",
}
AMOUNT = re.compile(r"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,12})$")
YEAR = re.compile(r"令和\s*([0-9０-９]{1,2})\s*年分")
DIGITS = str.maketrans("０１２３４５６７８９","0123456789")


def number(value):
    raw = str(value).strip().translate(DIGITS).replace("，",",")
    if not AMOUNT.fullmatch(raw): return None
    v = int(raw.replace(",",""))
    return v if 0 <= v <= 10**12 else None


def detect_year(text):
    found = {2018 + int(x.translate(DIGITS)) for x in YEAR.findall(text)}
    return next(iter(found)) if len(found) == 1 else None


def extract_codes(words):
    """A value must be a *single* numeric token right of its G-code in same row."""
    out, flags = {}, []
    anchors = [w for w in words if re.fullmatch(r"G[0-9]{2}",w[4])]
    nums = [w for w in words if number(w[4]) is not None]
    for code in anchors:
        key = CODE_MAP.get(code[4])
        if key is None: continue
        choices = []
        for w in nums:
            if not (w[0] >= code[2]+1 and w[0] <= code[2]+125): continue
            if abs((w[1]+w[3])/2 - (code[1]+code[3])/2)>9: continue
            if any(a is not code and a[0]>code[0] and a[0]<w[0]
                   and abs(a[1]-code[1])<=9 for a in anchors): continue
            choices.append(w)
        if len(choices)!=1:
            if len(choices)>1: flags.append("AMBIGUOUS_"+key)
            continue
        val=number(choices[0][4])
        if key in out and out[key]!=val:
            flags.append("CONFLICT_"+key); out.pop(key,None)
        elif "CONFLICT_"+key not in flags: out[key]=val
    return out, flags


def extract_labelled(text):
    result={}
    for row in text.splitlines():
        m=re.match(r"^\s*(.+?)\s*[:：\t]\s*([0-9０-９,，]+)\s*$",row)
        if not m: continue
        field=TEXT_MAP.get(m.group(1).strip())
        val=number(m.group(2))
        if field is not None and val is not None: result[field]=val
    return result


def image_words(image, scale=1):
    try:
        import pytesseract
        from pytesseract import Output
        data=pytesseract.image_to_data(
            image,lang="jpn+eng",config="--psm 11",output_type=Output.DICT)
    except Exception as exc:
        raise RuntimeError("Japanese/English offline OCR is not installed") from exc
    words=[]
    for i,raw in enumerate(data["text"]):
        if not str(raw).strip(): continue
        x,y=float(data["left"][i])/scale,float(data["top"][i])/scale
        w,h=float(data["width"][i])/scale,float(data["height"][i])/scale
        words.append((x,y,x+w,y+h,str(raw).strip()))
    return " ".join(w[4] for w in words),words


def document_content(path):
    suffix=path.suffix.lower()
    if suffix==".pdf":
        try: import fitz
        except ImportError as exc: raise RuntimeError("PyMuPDF is required") from exc
        doc=fitz.open(str(path))
        try:
            if len(doc)!=1: return "",[],"MULTIPAGE_REVIEW"
            page=doc[0]
            words=page.get_text("words",sort=True)
            text=page.get_text("text",sort=True)
            if len(text.strip())>=40:
                return text,words,"PDF_TEXT"
            from PIL import Image
            pic=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
            return (*image_words(Image.frombytes("RGB",(pic.width,pic.height),pic.samples),2),"SCAN_OCR")
        finally: doc.close()
    if suffix in {".png",".jpg",".jpeg",".webp",".tif",".tiff",".bmp",".heic",".heif"}:
        from PIL import Image
        if suffix in {".heic",".heif"}:
            try:
                import pillow_heif
                pillow_heif.register_heif_opener()
            except ImportError as exc:
                raise RuntimeError("HEIC local decoder unavailable") from exc
        with Image.open(path) as image:
            text,words=image_words(image.convert("RGB"))
        return text,words,"IMAGE_OCR"
    return path.read_text(encoding="utf-8-sig"),[], "TEXT_LABELS"


def finish(year,fields,mode,warnings=None):
    warnings=list(warnings or [])
    allowed=set(CODE_MAP.values())|set(TEXT_MAP.values())
    fields={k:int(v) for k,v in fields.items()
            if k in allowed and isinstance(v,int) and not isinstance(v,bool)
            and 0<=v<=10**12}
    needed={"salary_gross","income_tax_withheld","social_insurance"}
    enough=year in (2025,2026) and needed.issubset(fields)
    if fields.get("salary_reference",0)>fields.get("salary_gross",0):
        enough=False;warnings.append("INVALID_SALARY_REFERENCE")
    if mode in {"IMAGE_OCR","SCAN_OCR"}:
        enough=False;warnings.append("OCR_REQUIRES_VERIFICATION")
    if "MULTIPAGE" in mode:
        enough=False;warnings.append("MULTIPAGE_REQUIRES_REVIEW")
    if any(x.startswith(("AMBIGUOUS_","CONFLICT_")) for x in warnings):
        enough=False
    if year not in (2025,2026): warnings.append("YEAR_NOT_APPROVED")
    if not enough: warnings.append("INCOMPLETE_OR_UNVERIFIED")
    return {"schema":"furusato-withholding-extract/v1",
            "status":"READY_FOR_EXCEL_CROSSCHECK" if enough else "REQUIRES_REVIEW",
            "year":year,"format":mode,"fields":fields,
            "warnings":sorted(set(warnings)),
            "personal_identifiers":"NEVER_EXTRACTED"}


def extract(path):
    path=Path(path)
    ext=path.suffix.lower()
    if ext not in SUPPORTED: raise ValueError("Unsupported format")
    if path.stat().st_size>25*1024*1024: raise ValueError("Input too large")
    if ext==".json":
        data=json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(data,dict) or data.get("schema")!="furusato-withholding/v1":
            raise ValueError("Unsupported JSON schema")
        return finish(data.get("year"),data.get("fields",{}),"STRUCTURED_JSON")
    if ext in {".tsv",".csv"}:
        with path.open(encoding="utf-8-sig",newline="") as f:
            reader=csv.DictReader(f,delimiter="\t" if ext==".tsv" else ",")
            if not {"field","value"}.issubset(reader.fieldnames or []):
                raise ValueError("Expected field,value columns")
            rows=list(reader)
        raw={r["field"]:r["value"] for r in rows}
        try: year=int(raw.get("year",""))
        except ValueError: year=None
        fields={k:number(v) for k,v in raw.items()
                if k!="year" and k in CODE_MAP.values()}
        return finish(year,{k:v for k,v in fields.items() if v is not None},"STRUCTURED_TEXT")
    text,words,mode=document_content(path)
    vals,flags=extract_codes(words) if words else ({},[])
    if not vals: vals=extract_labelled(text)
    return finish(detect_year(text),vals,mode,flags)


def write_bridge(result,output):
    """Allowlisted numeric rows only. Explicit status prevents implicit OCR use."""
    with Path(output).open("w",encoding="utf-8",newline="") as f:
        writer=csv.writer(f,delimiter="\t")
        writer.writerow(["STATUS",result["status"]])
        writer.writerow(["YEAR",result["year"] if result["year"] is not None else ""])
        for key,val in sorted(result["fields"].items()):
            writer.writerow([key,val])


if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input",required=True,type=Path)
    ap.add_argument("--output",required=True,type=Path)
    ap.add_argument("--bridge",type=Path)
    args=ap.parse_args()
    try:
        data=extract(args.input)
        args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        if args.bridge: write_bridge(data,args.bridge)
        print("READER_"+data["status"])
    except Exception as exc:
        print("READ_ERROR_"+type(exc).__name__,file=sys.stderr)
        sys.exit(2)
