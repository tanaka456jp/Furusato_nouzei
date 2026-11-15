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
    "G35":"mortgage_claim_count","G36":"mortgage_possible_credit",
    "G72":"special_relative_count", "G20":"under16_count",
    "G74":"special_relative_deduction_reference",
    "G46":"basic_reference",
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
    "住宅借入金等特別控除可能額":"mortgage_possible_credit",
    "住宅借入金等特別控除適用数":"mortgage_claim_count",
    "住宅借入金等特別控除居住開始年":"mortgage_occupancy_year",
}
AMOUNT = re.compile(r"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,12})$")
YEAR = re.compile(r"令和\s*([0-9０-９]{1,2})\s*年分")
DIGITS = str.maketrans("０１２３４５６７８９","0123456789")


def number(value):
    raw = str(value).strip().translate(DIGITS).replace("，",",")
    if not AMOUNT.fullmatch(raw): return None
    v = int(raw.replace(",",""))
    return v if 0 <= v <= 10**12 else None


def reject_duplicate_json_members(pairs):
    """Never accept silent last-write-wins for user-supplied JSON tax fields."""
    result = {}
    for key, value in pairs:
        if key in result:
            # Constant error, to avoid logging identifiers supplied by users.
            raise ValueError("Duplicate JSON member")
        result[key] = value
    return result


def detect_year(text):
    found = {2018 + int(x.translate(DIGITS)) for x in YEAR.findall(text)}
    return next(iter(found)) if len(found) == 1 else None


def extract_occupancy_year(text):
    """Read first housing occupancy year only when the N01/Reiwa anchor is clear.

    The Gregorian document income year (L01) must never be mistaken for
    the occupancy year, and multiple housing applications need review.
    """
    matches = re.findall(r"1回目\s*N01\s*令和\s*([0-9０-９]{1,2})", text)
    years = {2018 + int(x.translate(DIGITS)) for x in matches}
    if len(years) == 1:
        return {"mortgage_occupancy_year": years.pop()}
    return {}


def extract_codes(words):
    """A value must be a *single* numeric token right of its G-code in same row."""
    out, flags = {}, []
    anchors = [w for w in words if re.fullmatch(r"G[0-9]{2}",w[4])]
    nums = [w for w in words if number(w[4]) is not None]
    for code in anchors:
        # G73 is the secondary special-relative count, not the under-16 count.
        # G20 is the correct under-16 field in both attached form years.
        key = ("special_relative_subordinate_count" if code[4] == "G73"
               else CODE_MAP.get(code[4]))
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
        if code[4] == "G73":
            if val > 0:
                flags.append("UNSUPPORTED_SPECIAL_RELATIVE_SUBORDINATE_COUNT")
            continue
        if key in out and out[key]!=val:
            flags.append("CONFLICT_"+key); out.pop(key,None)
        elif "CONFLICT_"+key not in flags: out[key]=val
    return out, flags


def extract_labelled(text,with_flags=False):
    """Refuse invalid or conflicting labelled amounts before Excel crosscheck.

    Unrecognized labels are ignored. Recognized labels with unreadable
    numbers are never silently dropped just because the required salary
    fields happen to be present. Flags contain field codes, not source text.
    """
    result, flags = {}, []
    for row in text.splitlines():
        m=re.match(r"^\s*(.+?)\s*[:：\t]\s*(.*?)\s*$",row)
        if not m: continue
        field=TEXT_MAP.get(m.group(1).strip())
        if field is None: continue
        val=number(m.group(2))
        invalid="INVALID_LABELLED_"+field
        if val is None:
            result.pop(field,None)
            flags.append(invalid)
            continue
        if invalid in flags: continue
        conflict="CONFLICT_"+field
        if field in result and result[field]!=val:
            result.pop(field,None)
            flags.append(conflict)
        elif conflict not in flags:
            result[field]=val
    return (result,flags) if with_flags else result


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


def pdf_page_count(path):
    """Return the number of PDF pages without extracting identifiers or values."""
    path=Path(path)
    if path.suffix.lower()!=".pdf" or path.stat().st_size>25*1024*1024:
        raise ValueError("Expected a PDF no larger than 25 MiB")
    try: import fitz
    except ImportError as exc: raise RuntimeError("PyMuPDF is required") from exc
    with fitz.open(str(path)) as doc:
        if len(doc)<1 or len(doc)>100: raise ValueError("PDF must have 1 to 100 pages")
        return len(doc)


def document_content(path,page_number=None):
    suffix=path.suffix.lower()
    if suffix==".pdf":
        try: import fitz
        except ImportError as exc: raise RuntimeError("PyMuPDF is required") from exc
        doc=fitz.open(str(path))
        try:
            if len(doc)<1 or len(doc)>100: raise ValueError("PDF must have 1 to 100 pages")
            multiple=(len(doc)>1)
            if page_number is None and multiple:
                return "",[],"MULTIPAGE_REVIEW"
            if page_number is not None and (
                    type(page_number) is not int or page_number<1 or page_number>len(doc)):
                raise ValueError("Selected PDF page out of range")
            page=doc[0 if page_number is None else page_number-1]
            words=page.get_text("words",sort=True)
            text=page.get_text("text",sort=True)
            if len(text.strip())>=40:
                return text,words,"PDF_PAGE_SELECTED" if multiple else "PDF_TEXT"
            from PIL import Image
            pic=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
            mode="SCAN_OCR_PAGE_SELECTED" if multiple else "SCAN_OCR"
            return (*image_words(Image.frombytes("RGB",(pic.width,pic.height),pic.samples),2),mode)
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
    # A JSON float, string, or boolean must never become an apparently
    # approved income year through Excel's automatic integer conversion.
    if type(year) is not int:
        year=None
    if not isinstance(fields,dict):
        raise ValueError("Malformed structured fields")
    allowed=set(CODE_MAP.values())|set(TEXT_MAP.values())
    # A recognized optional field with an invalid numeric value must not
    # disappear while the remaining fields are marked crosscheck-ready.
    # Unknown identifier-like keys are never transferred to Excel.
    if any(k in allowed and (type(v) is not int or not 0<=v<=10**12)
           for k,v in fields.items()):
        warnings.append("INVALID_STRUCTURED_FIELD")
    fields={k:v for k,v in fields.items()
            if k in allowed and type(v) is int and 0<=v<=10**12}
    needed={"salary_gross","income_tax_withheld","social_insurance"}
    enough=type(year) is int and year in (2025,2026) and needed.issubset(fields)
    if fields.get("salary_reference",0)>fields.get("salary_gross",0):
        enough=False;warnings.append("INVALID_SALARY_REFERENCE")
    possible=fields.get("mortgage_possible_credit",0)
    used=fields.get("mortgage_credit")
    if possible>0 and used is None:
        # Infer an applied zero only where both the taxable salary income is
        # proven nonpositive and the slip explicitly states zero tax.
        if (fields.get("salary_reference") is not None
                and fields.get("deductions_reference") is not None
                and fields["deductions_reference"]>=fields["salary_reference"]
                and fields.get("income_tax_withheld")==0):
            fields["mortgage_credit"]=0
            used=0
            warnings.append("MORTGAGE_ZERO_FROM_ZERO_TAXABLE_INCOME")
        else:
            enough=False;warnings.append("MORTGAGE_APPLIED_CREDIT_MISSING")
    if possible>0 and "mortgage_occupancy_year" not in fields:
        enough=False;warnings.append("MORTGAGE_OCCUPANCY_YEAR_MISSING")
    if possible>0 and used is not None and used>possible:
        enough=False;warnings.append("MORTGAGE_APPLIED_EXCEEDS_POSSIBLE")
    # G72 is the special-relative count, G73 the under-16 count, and
    # G74 the special-relative tax deduction. The slip does not reveal all
    # qualifying relatives' incomes, so require an explicit reconciliation.
    special_count=fields.get("special_relative_count",0)
    special_deduction=fields.get("special_relative_deduction_reference",0)
    if special_count or special_deduction:
        enough=False
        warnings.append("SPECIAL_RELATIVE_REQUIRES_INCOME_DETAILS")
        if special_deduction and not special_count:
            warnings.append("SPECIAL_RELATIVE_COUNT_MISSING")
        if special_count>30:
            warnings.append("SPECIAL_RELATIVE_COUNT_EXCEEDS_UI")
    if fields.get("mortgage_claim_count",0)>1:
        enough=False;warnings.append("MULTIPLE_MORTGAGE_CREDITS_REQUIRE_REVIEW")
    if "mortgage_occupancy_year" in fields:
        occupancy_year = fields["mortgage_occupancy_year"]
        if not isinstance(year, int) or not 1980 <= occupancy_year <= year:
            enough=False;warnings.append("INVALID_MORTGAGE_OCCUPANCY_YEAR")
    if mode in {"IMAGE_OCR","SCAN_OCR","SCAN_OCR_PAGE_SELECTED"}:
        enough=False;warnings.append("OCR_REQUIRES_VERIFICATION")
    if mode in {"PDF_PAGE_SELECTED","SCAN_OCR_PAGE_SELECTED"}:
        enough=False;warnings.append("MULTIPAGE_SELECTED_PAGE_REVIEW")
    if "MULTIPAGE" in mode:
        enough=False;warnings.append("MULTIPAGE_REQUIRES_REVIEW")
    if any(x.startswith(("AMBIGUOUS_","CONFLICT_","INVALID_STRUCTURED_","INVALID_LABELLED_","UNSUPPORTED_")) for x in warnings):
        enough=False
    if type(year) is not int or year not in (2025,2026):
        warnings.append("YEAR_NOT_APPROVED")
    if not enough: warnings.append("INCOMPLETE_OR_UNVERIFIED")
    return {"schema":"furusato-withholding-extract/v1",
            "status":"READY_FOR_EXCEL_CROSSCHECK" if enough else "REQUIRES_REVIEW",
            "year":year,"format":mode,"fields":fields,
            "warnings":sorted(set(warnings)),
            "personal_identifiers":"NEVER_EXTRACTED"}


def extract(path,page_number=None):
    path=Path(path)
    ext=path.suffix.lower()
    if ext not in SUPPORTED: raise ValueError("Unsupported format")
    if path.stat().st_size>25*1024*1024: raise ValueError("Input too large")
    if page_number is not None and ext!=".pdf":
        raise ValueError("Page selection is supported for PDF only")
    if ext==".json":
        data=json.loads(path.read_text(encoding="utf-8-sig"),
                        object_pairs_hook=reject_duplicate_json_members)
        if not isinstance(data,dict) or data.get("schema")!="furusato-withholding/v1":
            raise ValueError("Unsupported JSON schema")
        return finish(data.get("year"),data.get("fields",{}),"STRUCTURED_JSON")
    if ext in {".tsv",".csv"}:
        with path.open(encoding="utf-8-sig",newline="") as f:
            reader=csv.DictReader(f,delimiter="\t" if ext==".tsv" else ",")
            if len(reader.fieldnames or []) != 2 or set(reader.fieldnames) != {"field","value"}:
                raise ValueError("Expected exactly field,value columns")
            rows=list(reader)
        if any(set(r) != {"field","value"} or r["field"] is None
               or r["value"] is None for r in rows):
            raise ValueError("Malformed structured row")
        if len({r["field"] for r in rows}) != len(rows):
            # Even repeated identical values must not bypass source review.
            # Never silently select the last conflicting tax figure.
            raise ValueError("Duplicate structured field")
        raw={r["field"]:r["value"] for r in rows}
        try: year=int(raw.get("year",""))
        except ValueError: year=None
        fields={k:number(v) for k,v in raw.items()
                if k!="year" and k in CODE_MAP.values()}
        return finish(year,fields,"STRUCTURED_TEXT")
    text,words,mode=document_content(path,page_number=page_number)
    vals,flags=extract_codes(words) if words else ({},[])
    if not vals:
        vals,label_flags=extract_labelled(text,with_flags=True)
        flags.extend(label_flags)
    # Occupancy year is an anchored field, not the document income year.
    # Never override a disagreeing structured value.
    occupancy=extract_occupancy_year(text)
    if occupancy and "mortgage_occupancy_year" in vals and vals["mortgage_occupancy_year"]!=occupancy["mortgage_occupancy_year"]:
        flags.append("CONFLICT_mortgage_occupancy_year")
        vals.pop("mortgage_occupancy_year",None)
    elif occupancy:
        vals.update(occupancy)
    return finish(detect_year(text),vals,mode,flags)


def write_bridge(result,output):
    """Allowlisted numeric rows only. Explicit status prevents implicit OCR use."""
    with Path(output).open("w",encoding="utf-8",newline="") as f:
        writer=csv.writer(f,delimiter="\t")
        writer.writerow(["STATUS",result["status"]])
        writer.writerow(["YEAR",result["year"] if result["year"] is not None else ""])
        # ASCII warnings, not raw personal data. The VBA UI can show precisely
        # why the extracted document is only a *provisional* import.
        writer.writerow(["WARNINGS",";".join(result.get("warnings",[]))])
        for key,val in sorted(result["fields"].items()):
            writer.writerow([key,val])


if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input",required=True,type=Path)
    ap.add_argument("--output",required=True,type=Path)
    ap.add_argument("--bridge",type=Path)
    ap.add_argument("--page",type=int,help="1-based page index, one taxpayer only")
    ap.add_argument("--page-count",action="store_true",help="write count only; never inspect tax values")
    args=ap.parse_args()
    try:
        if args.page_count:
            if args.page is not None or args.bridge is not None:
                raise ValueError("Page-count mode does not accept --page or --bridge")
            args.output.write_text(str(pdf_page_count(args.input))+"\n",encoding="ascii")
            print("PAGE_COUNT_READY")
            sys.exit(0)
        data=extract(args.input,page_number=args.page)
        args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        if args.bridge: write_bridge(data,args.bridge)
        print("READER_"+data["status"])
    except Exception as exc:
        print("READ_ERROR_"+type(exc).__name__,file=sys.stderr)
        sys.exit(2)
