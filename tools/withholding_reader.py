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
    # G09–G24 are anonymous checkbox/count/amount slots on the 2025/26
    # withholding format. They are not names, addresses or family identifiers.
    "G09":"spouse_deduction_flag", "G10":"secondary_spouse_flag",
    "G11":"elderly_spouse_flag", "G12":"spouse_tax_deduction",
    "G13":"specific_dependent_count", "G14":"secondary_specific_count",
    "G15":"cohabiting_elder_count", "G16":"elder_dependent_count",
    "G17":"secondary_elder_count", "G18":"general_dependent_count",
    "G19":"secondary_general_count",
    "G21":"cohabiting_special_disabled_count",
    "G22":"special_disabled_count", "G23":"ordinary_disabled_count",
    "G24":"nonresident_relative_count",
    "G43":"spouse_total_income",  # G42 is spouse personal number: NEVER ingest it.
    "G73":"secondary_special_relative_count",
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
            if len(choices)>1: flags.append("AMBIGUOUS_"+key.upper())
            continue
        val=number(choices[0][4])
        if key in out and out[key]!=val:
            flags.append("CONFLICT_"+key.upper()); out.pop(key,None)
        elif "CONFLICT_"+key.upper() not in flags: out[key]=val
    return out, flags



# The statutory form exposes only numeric/checkbox/count fields. Every code
# below is source-level and contains no name, address, or date of birth.
# The workbook must not guess "no family" if the expected tax-field row is absent.
FAMILY_FORM_CODES = frozenset(
    ("G09", "G10", "G11", "G12", "G13", "G14", "G15", "G16",
     "G17", "G18", "G19", "G20", "G21", "G22", "G23", "G24")
)


def family_transfer_warnings(words):
    code_names = {w[4] for w in words if re.fullmatch(r"G[0-9]{2}", w[4])}
    if not FAMILY_FORM_CODES.issubset(code_names):
        return ["FAMILY_LAYOUT_UNVERIFIED"]
    parsed, errors = extract_codes(words)
    warnings = [x for x in errors if x.startswith(("AMBIGUOUS_", "CONFLICT_"))]
    for field in ("spouse_deduction_flag", "secondary_spouse_flag",
                  "elderly_spouse_flag"):
        if parsed.get(field) not in (1, 2):
            warnings.append("FAMILY_CHECKBOX_UNVERIFIED")
    if parsed.get("secondary_spouse_flag") == 1:
        warnings.append("FAMILY_SECONDARY_SPOUSE_REQUIRES_REVIEW")
    if any(parsed.get(key, 0) > 0 for key in (
        "secondary_specific_count", "secondary_elder_count",
        "secondary_general_count", "secondary_special_relative_count",
        "nonresident_relative_count"
    )):
        warnings.append("FAMILY_SECONDARY_OR_NONRESIDENT_REQUIRES_REVIEW")
    if parsed.get("cohabiting_elder_count", 0) > parsed.get("elder_dependent_count", 0):
        warnings.append("FAMILY_ELDERLY_SUBCOUNT_INVALID")
    if parsed.get("cohabiting_special_disabled_count", 0) > parsed.get("special_disabled_count", 0):
        warnings.append("FAMILY_DISABLED_SUBCOUNT_INVALID")
    if parsed.get("specific_dependent_count", 0) > 3:
        warnings.append("FAMILY_SPECIFIC_OVER_THREE")
    spouse_claimed = parsed.get("spouse_deduction_flag") == 1
    tax_ded = parsed.get("spouse_tax_deduction", 0)
    if spouse_claimed and tax_ded == 0:
        warnings.append("FAMILY_SPOUSE_DEDUCTION_INCONSISTENT")
    if not spouse_claimed and tax_ded > 0 and "spouse_total_income" not in parsed:
        # Spouse SPECIAL deduction cannot be inferred exactly from its tax
        # amount alone: different income bands may have a resident-tax effect.
        warnings.append("FAMILY_SPOUSE_INCOME_NEEDED")
    if spouse_claimed and parsed.get("spouse_total_income", 0) > 620000:
        warnings.append("FAMILY_SPOUSE_INCOME_INCONSISTENT")
    return sorted(set(warnings))



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
        if special_count>3:
            warnings.append("SPECIAL_RELATIVE_COUNT_EXCEEDS_UI")
    if fields.get("mortgage_claim_count",0)>1:
        enough=False;warnings.append("MULTIPLE_MORTGAGE_CREDITS_REQUIRE_REVIEW")
    if "mortgage_occupancy_year" in fields:
        occupancy_year = fields["mortgage_occupancy_year"]
        if not isinstance(year, int) or not 1980 <= occupancy_year <= year:
            enough=False;warnings.append("INVALID_MORTGAGE_OCCUPANCY_YEAR")
    if mode in {"IMAGE_OCR","SCAN_OCR"}:
        enough=False;warnings.append("OCR_REQUIRES_VERIFICATION")
    if "MULTIPAGE" in mode:
        enough=False;warnings.append("MULTIPAGE_REQUIRES_REVIEW")
    if any(x.startswith(("AMBIGUOUS_", "CONFLICT_", "FAMILY_")) for x in warnings):
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
    if words:
        flags.extend(family_transfer_warnings(words))
    if not vals: vals=extract_labelled(text)
    # Occupancy year is an anchored field, not the document income year.
    # Never override a disagreeing structured value.
    occupancy=extract_occupancy_year(text)
    if occupancy and "mortgage_occupancy_year" in vals and vals["mortgage_occupancy_year"]!=occupancy["mortgage_occupancy_year"]:
        flags.append("CONFLICT_MORTGAGE_OCCUPANCY_YEAR")
        vals.pop("mortgage_occupancy_year",None)
    elif occupancy:
        vals.update(occupancy)
    return finish(detect_year(text),vals,mode,flags)



# Local batch PDF reader. Each page is treated as an INDEPENDENT taxpayer.
# Never store, forward or inspect names, employer or address as output fields.
BATCH_MAX_PAGES = 20
BATCH_FIELDS = tuple(sorted(set(CODE_MAP.values()) | set(TEXT_MAP.values())))


def pdf_page_count(path):
    """Read only PDF structure: never parse or report names or financial data."""
    path = Path(path)
    if path.suffix.lower() != ".pdf" or not path.is_file():
        raise ValueError("PDF_PAGE_PROBE_INPUT_INVALID")
    if not 0 < path.stat().st_size <= 25 * 1024 * 1024:
        raise ValueError("PDF_PAGE_PROBE_SIZE_INVALID")
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required") from exc
    with fitz.open(str(path)) as document:
        if document.is_encrypted or len(document) < 1:
            raise ValueError("PDF_PAGE_PROBE_UNSUPPORTED")
        return len(document)


def extract_pdf_batch(path):
    """Return only page ordinals, tax-year, numeric fields and machine codes."""
    path = Path(path)
    if path.suffix.lower() != ".pdf":
        raise ValueError("Batch source must be a PDF")
    if not path.is_file() or not 0 < path.stat().st_size <= 25 * 1024 * 1024:
        raise ValueError("Batch PDF exceeds 25MiB")
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF required") from exc
    records = []
    with fitz.open(str(path)) as doc:
        if doc.is_encrypted or not 1 <= len(doc) <= BATCH_MAX_PAGES:
            raise ValueError("Unsupported encrypted PDF or page count")
        for page_number, page in enumerate(doc, 1):
            try:
                text = page.get_text("text", sort=True)
                words = page.get_text("words", sort=True)
                mode = "PDF_TEXT"
                if len(text.strip()) < 40:
                    from PIL import Image
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    if pix.width * pix.height > 25_000_000:
                        raise ValueError("Page raster too large")
                    pic = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                    text, words = image_words(pic, 2)
                    mode = "SCAN_OCR"
                fields, warnings = extract_codes(words) if words else ({}, [])
                if words:
                    warnings.extend(family_transfer_warnings(words))
                if not fields:
                    fields = extract_labelled(text)
                occupancy = extract_occupancy_year(text)
                if (occupancy and "mortgage_occupancy_year" in fields and
                        fields["mortgage_occupancy_year"] != occupancy["mortgage_occupancy_year"]):
                    warnings.append("CONFLICT_MORTGAGE_OCCUPANCY_YEAR")
                    fields.pop("mortgage_occupancy_year", None)
                else:
                    fields.update(occupancy)
                record = finish(detect_year(text), fields, mode, warnings)
            except Exception:
                record = finish(None, {}, "PAGE_ERROR", ["PAGE_READ_FAILED"])
            records.append({"page": page_number, **record})
    return records


def write_batch_bridge(records, output):
    """ASCII-only page-separated TSV consumed by VBA after full validation."""
    if not 1 <= len(records) <= BATCH_MAX_PAGES:
        raise ValueError("Unsupported page count")
    with Path(output).open("w", encoding="ascii", newline="") as fp:
        writer = csv.writer(fp, delimiter="\t", lineterminator="\n")
        for ordinal, record in enumerate(records, 1):
            if record.get("page") != ordinal:
                raise ValueError("PDF pages not sequential")
            writer.writerow(["PAGE", ordinal])
            writer.writerow(["STATUS", record["status"]])
            writer.writerow(["YEAR", record["year"] or ""])
            warnings = record.get("warnings", [])
            if any(not re.fullmatch(r"[A-Z_0-9]+", flag) for flag in warnings):
                raise ValueError("Unsafe warning code")
            writer.writerow(["WARNINGS", ";".join(warnings)])
            for key in BATCH_FIELDS:
                value = record["fields"].get(key)
                if value is not None:
                    if (isinstance(value, bool) or not isinstance(value, int) or
                            not 0 <= value <= 10**12):
                        raise ValueError("Unsafe numeric field")
                    writer.writerow([key, value])
            writer.writerow(["ENDPAGE", ordinal])


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
    ap.add_argument("--batch-bridge",type=Path)
    ap.add_argument("--probe-pages",action="store_true")
    args=ap.parse_args()
    try:
        if args.probe_pages:
            if args.bridge or args.batch_bridge:
                raise ValueError("PDF_PAGE_PROBE_CONFLICTING_OPTIONS")
            # The ASCII probe contains exactly one non-identifying integer.
            # Single-slip VBA routes 2+ page PDFs to the isolated batch UI.
            count = pdf_page_count(args.input)
            with args.output.open("w",encoding="ascii",newline="\n") as probe:
                probe.write("PDF_PAGES\t" + str(count) + "\n")
            print("READER_PDF_PAGE_PROBE_OK")
        elif args.batch_bridge:
            records=extract_pdf_batch(args.input)
            write_batch_bridge(records,args.batch_bridge)
            args.output.write_text(json.dumps({
                "schema":"furusato-batch-summary/v1",
                "pages":len(records),
                "review_required":sum(
                    r["status"]!="READY_FOR_EXCEL_CROSSCHECK" for r in records),
            },ensure_ascii=True)+"\n",encoding="ascii")
            print("READER_BATCH_PAGES_"+str(len(records)))
        else:
            data=extract(args.input)
            args.output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
            if args.bridge: write_bridge(data,args.bridge)
            print("READER_"+data["status"])
    except Exception as exc:
        print("READ_ERROR_"+type(exc).__name__,file=sys.stderr)
        sys.exit(2)
