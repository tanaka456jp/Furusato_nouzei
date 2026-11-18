"""Synthetic parser tests: no actual personal documents in git or CI."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess
import sys
import unittest
from unittest.mock import patch
from withholding_reader import CODE_MAP,detect_year,extract_codes,extract_labelled,extract_occupancy_year,extract,finish,write_bridge,pdf_page_count
from audit_withholding_reconciliation import progressive_income_tax, reconcile
from bulk_salary_only import evaluate_page, write_batch_bridge, all_page_rows, COLUMNS


def pdf_fixture_library():
    try:
        # Production uses PDFium. Use the separate audit-only library to
        # create fixtures so the parser is tested against independent files.
        import pypdfium2
        import fitz
    except ImportError as exc:
        raise unittest.SkipTest("PDF runtime or independent fixture writer omitted") from exc
    return fitz


class WithholdingTest(unittest.TestCase):
    def test_multiple_pdf_pages_require_explicit_selection_and_review(self):
        # Two different, synthetic taxpayers in one PDF. No private documents.
        fitz = pdf_fixture_library()
        with TemporaryDirectory() as tmp:
            file=Path(tmp)/"two-slips.pdf"
            doc=fitz.open()
            for salary in (5000000,7000000):
                page=doc.new_page()
                page.insert_text((40,30),"G04 "+format(salary,","))
                page.insert_text((40,55),"G08 0")
                page.insert_text((40,80),"G26 1,000,000")
                page.insert_text((40,120),"ANONYMOUS SYNTHETIC SAMPLE: EXPLICIT PAGE SELECTION")
            doc.save(str(file))
            doc.close()
            self.assertEqual(pdf_page_count(file),2)
            unselected=extract(file)
            self.assertEqual(unselected["fields"],{})
            self.assertEqual(unselected["status"],"REQUIRES_REVIEW")
            first=extract(file,page_number=1)
            second=extract(file,page_number=2)
            self.assertEqual(first["fields"]["salary_gross"],5000000)
            self.assertEqual(second["fields"]["salary_gross"],7000000)
            self.assertEqual(first["format"],"PDF_PAGE_SELECTED")
            self.assertEqual(second["format"],"PDF_PAGE_SELECTED")
            for result in (first,second):
                self.assertEqual(result["status"],"REQUIRES_REVIEW")
                self.assertIn("MULTIPAGE_SELECTED_PAGE_REVIEW",result["warnings"])
                self.assertNotIn("personal_name",result["fields"])
            for invalid in (0,3,99,-1):
                with self.assertRaises(ValueError):
                    extract(file,page_number=invalid)
            count_output=Path(tmp)/"page-count.txt"
            cli=Path(__file__).resolve().parent/"withholding_reader.py"
            subprocess.run([sys.executable,str(cli),"--input",str(file),
                            "--output",str(count_output),"--page-count"],
                           check=True,capture_output=True,text=True)
            self.assertEqual(count_output.read_text(encoding="ascii").strip(),"2")
            output=Path(tmp)/"selected-result.json"
            bridge=Path(tmp)/"selected-bridge.tsv"
            subprocess.run([sys.executable,str(cli),"--input",str(file),
                            "--output",str(output),"--bridge",str(bridge),
                            "--page","2"],
                           check=True,capture_output=True,text=True)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["fields"]["salary_gross"],7000000)
            self.assertIn("salary_gross"+chr(9)+"7000000",bridge.read_text(encoding="ascii"))
            self.assertNotIn("5000000",bridge.read_text(encoding="ascii"))

    def test_pdf_text_g20_child_count_and_g73_secondary_count_do_not_mix(self):
        """Exercise the actual PDF word-extraction path, not only word tuples."""
        fitz = pdf_fixture_library()
        with TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "anonymous-g20-g73.pdf"
            doc = fitz.open()
            for secondary in (False, True):
                page = doc.new_page()
                # Synthetic layout only; no names or real monetary data.
                for x, y, label in (
                    (40, 30, "G04 5,000,000"),
                    (40, 55, "G08 0"),
                    (40, 80, "G26 1,000,000"),
                    (40, 120, "G72"),
                    (105, 120, "G73"),
                    (185, 120, "G20"),
                    (225, 120, "4"),
                    (40, 200, "SYNTHETIC NO PRIVATE DATA SOURCE FIELD TEST"),
                ):
                    page.insert_text((x, y), label, fontsize=10)
                if secondary:
                    page.insert_text((145, 120), "1", fontsize=10)
            doc.save(str(pdf))
            doc.close()
            self.assertEqual(pdf_page_count(pdf), 2)
            # Page 1: blank G73 does not capture the adjacent G20 count.
            blank = extract(pdf, page_number=1)
            self.assertEqual(blank["fields"]["under16_count"], 4)
            self.assertNotIn("UNSUPPORTED_SPECIAL_RELATIVE_SUBORDINATE_COUNT",
                             blank["warnings"])
            self.assertEqual(blank["status"], "REQUIRES_REVIEW")
            self.assertIn("MULTIPAGE_SELECTED_PAGE_REVIEW", blank["warnings"])
            # Page 2: G73=1 is a separate, unsupported count, not children.
            secondary = extract(pdf, page_number=2)
            self.assertEqual(secondary["fields"]["under16_count"], 4)
            self.assertNotIn("special_relative_subordinate_count",
                             secondary["fields"])
            self.assertIn("UNSUPPORTED_SPECIAL_RELATIVE_SUBORDINATE_COUNT",
                          secondary["warnings"])
            self.assertEqual(secondary["status"], "REQUIRES_REVIEW")
            bridge = Path(tmp) / "second-page.tsv"
            write_bridge(secondary, bridge)
            payload = bridge.read_text(encoding="ascii")
            self.assertIn("under16_count\t4", payload)
            self.assertIn("STATUS\tREQUIRES_REVIEW", payload)
            self.assertNotIn("special_relative_subordinate_count\t", payload)

    def test_pdf_text_and_blank_selected_page_do_not_mix(self):
        fitz = pdf_fixture_library()
        with TemporaryDirectory() as temp:
            source = Path(temp) / "合成のみ.pdf"
            with fitz.open() as doc:
                page = doc.new_page()
                page.insert_text((40, 30), "G04 7,000,000")
                page.insert_text((40, 55), "G08 0")
                page.insert_text((40, 80), "G26 1,000,000")
                page.insert_text((40, 120), "SYNTHETIC PDF TEXT PAGE")
                doc.new_page()
                doc.save(source)
            with patch("withholding_reader.image_words") as ocr:
                self.assertEqual(pdf_page_count(source), 2)
                self.assertEqual(extract(source)["fields"], {})
                self.assertEqual(extract(source, page_number=1)["fields"]["salary_gross"],
                                 7_000_000)
                blank = extract(source, page_number=2)
                self.assertEqual(blank["format"], "SCAN_OCR_PAGE_SELECTED")
                self.assertEqual(blank["status"], "REQUIRES_REVIEW")
                self.assertEqual(blank["fields"], {})
                self.assertIn("MULTIPAGE_SELECTED_PAGE_REVIEW", blank["warnings"])
                ocr.assert_not_called()

    def test_pdf_image_render_preserves_ocr_scale_and_review(self):
        fitz = pdf_fixture_library()
        with TemporaryDirectory() as temp:
            source = Path(temp) / "synthetic-raster.pdf"
            with fitz.open() as doc:
                page = doc.new_page(width=250, height=175)
                page.insert_text((20, 35), "G04 7,000,000", fontsize=14)
                png = page.get_pixmap().tobytes("png")
                page = doc.new_page(width=250, height=175)
                page.insert_image(page.rect, stream=png)
                doc.delete_page(0)
                doc.save(source)

            def ocr(image, scale):
                self.assertEqual((image.mode, image.size, scale), ("RGB", (500, 350), 2))
                self.assertTrue(any(lo < hi for lo, hi in image.getextrema()))
                return ("令和 8 年分", [(20, 24, 45, 35, "G04"), (50, 24, 109, 35, "7,000,000")])

            with patch("withholding_reader.image_words", side_effect=ocr) as simulated_ocr:
                report = extract(source)
            simulated_ocr.assert_called_once()
            self.assertEqual(report["format"], "SCAN_OCR")
            self.assertEqual(report["fields"], {"salary_gross": 7_000_000})
            self.assertEqual(report["status"], "REQUIRES_REVIEW")
            self.assertIn("OCR_REQUIRES_VERIFICATION", report["warnings"])

    def test_spouse_g43_requires_age_review(self):
        # Synthetic G43/G46 geometry, not an actual taxpayer slip.
        words = [(270,484,281,490,"G43"),(338,482,372,492,"250,000"),
                 (374,500,385,506,"G46"),(438,499,472,509,"630,000")]
        fields, warnings = extract_codes(words)
        self.assertEqual(warnings, [])
        self.assertEqual(fields["spouse_income_reference"],250000)
        self.assertEqual(fields["basic_reference"],630000)
        report = finish(2025,{**fields,"salary_gross":7000000,
            "social_insurance":1000000,"income_tax_withheld":0},"PDF_TEXT")
        self.assertEqual(report["status"],"REQUIRES_REVIEW")
        self.assertIn("SPOUSE_AGE_AND_INCOME_REVIEW",report["warnings"])
        with TemporaryDirectory() as tmp:
            target=Path(tmp)/"bridge.tsv"
            write_bridge(report,target)
            data=target.read_text(encoding="utf-8")
            self.assertIn("spouse_income_reference"+chr(9)+"250000",data)
            self.assertIn("STATUS"+chr(9)+"REQUIRES_REVIEW",data)
        absent=finish(2025,{"salary_gross":7000000,
            "social_insurance":1000000,"income_tax_withheld":0},"PDF_TEXT")
        self.assertEqual(absent["status"],"READY_FOR_EXCEL_CROSSCHECK")

    def test_independent_national_tax_marginal_boundaries(self):
        # Year-end income tax: independent marginal slices, no workbook formulas.
        for taxable, expected in (
                (0,0), (1_949_000,97_450), (1_950_000,97_500),
                (1_951_000,97_600), (3_300_000,232_500),
                (6_950_000,962_500), (9_000_000,1_434_000),
                (18_000_000,4_404_000), (40_000_000,13_204_000)):
            self.assertEqual(progressive_income_tax(taxable),expected)
        with self.assertRaises(ValueError):
            progressive_income_tax(-1)

    def test_year_end_source_tax_oracle_does_not_approve_donation_limit(self):
        # Fully synthetic and anonymized, not a user's withholding slip.
        nominal={"salary_reference":3_560_000,
                 "deductions_reference":1_560_000,
                 "income_tax_withheld":104_600}
        for year in (2025,2026):
            matched=reconcile(year,nominal)
            self.assertEqual(matched["source_tax"],"MATCH")
            self.assertEqual(matched["donation_limit"],"NOT_VERIFIED")
        self.assertEqual(reconcile(2025,{**nominal,
            "income_tax_withheld":100_000})["source_tax"],"MISMATCH")
        self.assertEqual(reconcile(2025,{"income_tax_withheld":0})
                         ["source_tax"],"NOT_COMPARABLE")
        self.assertEqual(reconcile(2027,nominal)["reason"],"UNAPPROVED_YEAR")
        self.assertEqual(reconcile("2026",nominal)["reason"],"UNAPPROVED_YEAR")

    def test_independent_source_tax_mortgage_zero_and_missing_credit(self):
        # Distinguish source housing credit 'possible' from 'actually used'.
        zero={"salary_reference":3_560_000,
              "deductions_reference":3_956_000,
              "income_tax_withheld":0,
              "mortgage_possible_credit":300_000}
        self.assertEqual(reconcile(2026,zero)["source_tax"],"MATCH")
        taxable={"salary_reference":3_560_000,
                 "deductions_reference":1_560_000,
                 "income_tax_withheld":0,
                 "mortgage_possible_credit":300_000}
        self.assertEqual(reconcile(2026,taxable)["reason"],
                         "HOUSING_APPLIED_CREDIT_MISSING")
        applied={**taxable,"mortgage_credit":102_500}
        self.assertEqual(reconcile(2026,applied)["source_tax"],"MATCH")
        self.assertEqual(reconcile(2026,{**applied,
            "mortgage_credit":200_000})["reason"],"INVALID_HOUSING_CREDIT")
        self.assertEqual(reconcile(2025,{**taxable,
            "salary_reference":330_000_001})["reason"],
                         "HIGH_INCOME_TAX_SPECIAL_CASE")

    def test_years(self):
        self.assertEqual(detect_year("令和 8 年分 給与所得の源泉徴収票"),2026)
        self.assertEqual(detect_year("令和 7 年分"),2025)
        self.assertIsNone(detect_year("令和 7 年分 令和 8 年分"))

    def test_layered_pdf_income_year_uses_l01_geometry_not_text_order(self):
        # NTA-style embedded PDF layers can put the year digit before
        # the Reiwa era and the L01 label in extracted text. All synthetic.
        header = [
            (77, 51, 85, 56, "L01"),
            (94, 47, 118, 59, "令和"),
            (141, 47, 152, 59, "7"),
            (169, 48, 193, 60, "年分"),
        ]
        self.assertIsNone(detect_year("7\\n令和\\nL01 年分"))
        self.assertEqual(detect_year("7\\n令和\\nL01 年分", header), 2025)
        self.assertIsNone(detect_year("令和 8 年分", header))
        self.assertIsNone(detect_year("令和 7 年分 令和 8 年分", header))
        # The source's housing occupancy year must not be used.
        elsewhere = [(94, 47, 118, 59, "令和"),
                     (141, 47, 152, 59, "7"),
                     (169, 48, 193, 60, "年分")]
        self.assertIsNone(detect_year("7\\n令和", elsewhere))
        new_year = [(x0, y0, x1, y1, "8" if token == "7" else token)
                    for x0, y0, x1, y1, token in header]
        self.assertEqual(detect_year("8\\n令和\\nL01 年分", new_year), 2026)

    def test_five_page_native_pdf_year_and_case_isolation(self):
        """End-to-end PDFium test: five anonymous pages with scrambled headers."""
        fitz = pdf_fixture_library()
        with TemporaryDirectory() as folder:
            source = Path(folder) / "five-anonymous-slips.pdf"
            with fitz.open() as document:
                for index in range(5):
                    page = document.new_page(width=595, height=842)
                    # Same visual L01 pattern as a withholding form, but
                    # deliberately stagger the year glyph vertically so the
                    # PDF text layer does NOT contain "令和 7 年分".
                    page.insert_text((141, 50), "7", fontsize=12)
                    page.insert_text((93, 60), "令和", fontname="japan", fontsize=12)
                    page.insert_text((77, 58), "L01", fontsize=7)
                    page.insert_text((169, 60), "年分", fontname="japan", fontsize=12)
                    page.insert_text((104, 220), "G04", fontsize=7)
                    page.insert_text((178, 220),
                                     format(5_000_000 + index * 100_000, ","),
                                     fontsize=12)
                    page.insert_text((452, 220), "G08", fontsize=7)
                    page.insert_text((533, 220), "0", fontsize=12)
                    page.insert_text((138, 310), "G26", fontsize=7)
                    if index != 3:
                        page.insert_text((215, 310), "1,000,000", fontsize=12)
                    # Native text must exceed the reader's 40-char threshold.
                    page.insert_text((40, 500),
                                     "SYNTHETIC FIVE PAGE SOURCE ANONYMOUS NO PERSONAL DATA",
                                     fontsize=10)
                document.save(source)
            # Verify a real PDF parser takes the geometry fallback path.
            import pypdfium2
            with pypdfium2.PdfDocument(source) as pdf:
                self.assertEqual(len(pdf), 5)
                for index in range(5):
                    text_page = pdf[index].get_textpage()
                    try:
                        self.assertIsNone(detect_year(text_page.get_text_bounded()))
                    finally:
                        text_page.close()

            self.assertEqual(pdf_page_count(source), 5)
            self.assertIsNone(extract(source)["year"])
            for number in range(1, 6):
                result = extract(source, page_number=number)
                self.assertEqual(result["year"], 2025)
                self.assertEqual(result["fields"]["salary_gross"],
                                 5_000_000 + (number - 1) * 100_000)
                self.assertEqual(result["fields"]["income_tax_withheld"], 0)
                self.assertEqual(result["status"], "REQUIRES_REVIEW")
                self.assertIn("MULTIPAGE_SELECTED_PAGE_REVIEW", result["warnings"])
                if number == 4:
                    self.assertEqual(result["fields"]["social_insurance"], 0)
                    self.assertIn("BLANK_SOCIAL_INSURANCE_REQUIRES_REVIEW",
                                  result["warnings"])
                else:
                    self.assertEqual(result["fields"]["social_insurance"], 1_000_000)
                    self.assertNotIn("BLANK_SOCIAL_INSURANCE_REQUIRES_REVIEW",
                                     result["warnings"])

    def test_batch_salary_only_provisional_and_complex_hold(self):
        # No names, no addresses, no outside income: five independent rows.
        simple = {
            "schema": "furusato-withholding-extract/v1",
            "year": 2025, "format": "PDF_PAGE_SELECTED",
            "status": "REQUIRES_REVIEW",
            "warnings": ["MULTIPAGE_SELECTED_PAGE_REVIEW",
                         "INCOMPLETE_OR_UNVERIFIED"],
            "fields": {
                "salary_gross": 5_000_000,
                "salary_reference": 3_560_000,
                "deductions_reference": 1_680_000,
                "income_tax_withheld": 95_900,
                "social_insurance": 1_000_000,
                "basic_reference": 680_000,
            },
        }
        first = evaluate_page(1, simple)
        self.assertEqual(first["STATUS"], "PROVISIONAL")
        self.assertIsInstance(first["REFERENCE_LIMIT"], int)
        self.assertGreater(first["REFERENCE_LIMIT"], 0)
        self.assertEqual(first["REASON"], "SALARY_ONLY_HYPOTHESIS")
        housing = evaluate_page(2, {**simple,
            "fields": {**simple["fields"], "mortgage_credit": 50_000}})
        self.assertEqual(housing["STATUS"], "HOLD")
        self.assertEqual(housing["REFERENCE_LIMIT"], "")
        self.assertEqual(housing["REASON"], "COMPLEX_DEDUCTIONS_SINGLE_ONLY")
        family = evaluate_page(3, {**simple,
            "fields": {**simple["fields"], "under16_count": 1}})
        self.assertEqual(family["STATUS"], "HOLD")
        wrong_tax = evaluate_page(4, {**simple,
            "fields": {**simple["fields"], "income_tax_withheld": 0}})
        self.assertEqual(wrong_tax["REASON"], "SOURCE_TAX_NOT_RECONCILED")
        bad_year = evaluate_page(5, {**simple, "year": None})
        self.assertEqual(bad_year["STATUS"], "HOLD")
        self.assertEqual(bad_year["REASON"], "YEAR_UNREADABLE")
        with TemporaryDirectory() as folder:
            path = Path(folder) / "private-safe-numeric-only.tsv"
            write_batch_bridge([first, housing, family, wrong_tax, bad_year], path)
            content = path.read_text(encoding="ascii")
            rows = content.splitlines()
            self.assertEqual(len(rows), 6)
            self.assertEqual(rows[0].split("\t"), list(COLUMNS))
            self.assertTrue(rows[1].startswith("1\t2025\t5000000"))
            self.assertEqual(rows[2].split("\t")[7], "")
            self.assertNotIn("private_name", content)

    def test_batch_pdf_pages_are_independent_and_errors_are_isolated(self):
        with TemporaryDirectory() as folder:
            pdf = Path(folder) / "anonymous.pdf"
            pdf.write_bytes(b"synthetic disposable; PDF functions mocked")
            base = {"year": 2025, "fields": {}, "warnings": []}
            with patch("withholding_reader.pdf_page_count", return_value=5):
                with patch("withholding_reader.extract",
                           side_effect=[base, base, RuntimeError("PRIVATE SOURCE"),
                                        base, base]):
                    rows = all_page_rows(pdf)
            self.assertEqual(len(rows), 5)
            self.assertEqual([r["PAGE"] for r in rows], [1, 2, 3, 4, 5])
            self.assertEqual(rows[2]["STATUS"], "HOLD")
            self.assertEqual(rows[2]["REASON"], "PAGE_READ_ERROR")
            self.assertNotIn("PRIVATE", str(rows))

    def test_layered_pdf_mortgage_occupancy_n01_date_geometry(self):
        # The housing date must come from the N01 row, not the L01 title.
        house = [
            (226, 420, 239, 426, "1回目"),
            (242, 420, 253, 426, "N01"),
            (256, 419, 274, 428, "令和"),
            (288, 419, 297, 428, "6"),
            (308, 419, 322, 428, "12"),
            (330, 419, 343, 428, "22"),
        ]
        self.assertEqual(
            extract_occupancy_year("6\\n令和\\nN01", house),
            {"mortgage_occupancy_year": 2024},
        )
        self.assertEqual(extract_occupancy_year("6\\n令和", house[2:]), {})
        # Never choose an arbitrary winner from contradictory evidence.
        self.assertEqual(
            extract_occupancy_year("1回目 N01 令和 5", house), {},
        )

    def test_layered_pdf_blank_social_insurance_is_provisional(self):
        # A genuinely empty G26 box must not block transcription entirely
        # or be silently approved as a confirmed zero.
        words = [
            (77, 51, 85, 56, "L01"), (94, 47, 118, 59, "令和"),
            (141, 47, 152, 59, "7"), (169, 48, 193, 60, "年分"),
            (104, 218, 115, 223, "G04"), (178, 215, 233, 226, "5,000,000"),
            (452, 218, 463, 223, "G08"), (533, 215, 538, 224, "0"),
            (138, 308, 149, 314, "G26"),
        ]
        with TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic-only.pdf"
            source.write_bytes(b"SYNTHETIC FIXTURE; DOCUMENT CONTENT MOCKED")
            with patch("withholding_reader.document_content",
                       return_value=("7\\n令和\\nL01 年分", words, "PDF_TEXT")):
                record = extract(source)
            self.assertEqual(record["year"], 2025)
            self.assertEqual(record["fields"]["social_insurance"], 0)
            self.assertEqual(record["fields"]["salary_gross"], 5_000_000)
            self.assertEqual(record["status"], "REQUIRES_REVIEW")
            self.assertIn("BLANK_SOCIAL_INSURANCE_REQUIRES_REVIEW",
                          record["warnings"])
            bridge = Path(folder) / "result.tsv"
            write_bridge(record, bridge)
            self.assertIn("YEAR\t2025", bridge.read_text(encoding="utf-8"))
            self.assertIn("social_insurance\t0", bridge.read_text(encoding="utf-8"))
            # A separately printed amount keeps the existing READY behavior.
            with patch("withholding_reader.document_content",
                       return_value=("7\\n令和\\nL01 年分",
                                     words + [(215, 305, 260, 314, "1,000,000")],
                                     "PDF_TEXT")):
                explicit = extract(source)
            self.assertEqual(explicit["fields"]["social_insurance"], 1_000_000)
            self.assertNotIn("BLANK_SOCIAL_INSURANCE_REQUIRES_REVIEW",
                             explicit["warnings"])
            self.assertEqual(explicit["status"], "READY_FOR_EXCEL_CROSSCHECK")

    def test_g_codes_with_nearby_amounts(self):
        words=[
            (104,218,115,223,"G04"),(178,215,233,226,"5,000,000"),
            (231,209,242,215,"G05"),(289,207,344,218,"3,560,000"),
            (341,209,352,215,"G06"),(398,207,453,218,"3,956,000"),
            (138,308,149,314,"G26"),(215,305,260,314,"1,600,000"),
            (452,218,463,223,"G08"),(533,215,538,224,"0")]
        result,flags=extract_codes(words)
        self.assertEqual(flags,[])
        self.assertEqual(result["salary_gross"],5000000)
        self.assertEqual(result["salary_reference"],3560000)
        self.assertEqual(result["deductions_reference"],3956000)
        self.assertEqual(result["social_insurance"],1600000)
        self.assertEqual(result["income_tax_withheld"],0)

    def test_labelled(self):
        self.assertEqual(extract_labelled("支払金額：5,000,000\n社会保険料等の金額：1,000,000"),
                         {"salary_gross":5000000,"social_insurance":1000000})

    def test_structured_csv_does_not_leak_names(self):
        with TemporaryDirectory() as tmp:
            p=Path(tmp)/"input.csv"
            p.write_text("field,value\nyear,2026\nsalary_gross,7000000\nsocial_insurance,1000000\nincome_tax_withheld,0\nname,private\n",encoding="utf-8")
            data=extract(p)
            self.assertEqual(data["status"],"READY_FOR_EXCEL_CROSSCHECK")
            self.assertNotIn("name",data["fields"])
            dest=Path(tmp)/"out.tsv"
            write_bridge(data,dest)
            self.assertNotIn("private",dest.read_text(encoding="utf-8"))
            self.assertFalse(dest.read_bytes().startswith(b"\xef\xbb\xbf"))

    def test_year_and_ocr_do_not_auto_approve(self):
        fields={"salary_gross":7000000,"social_insurance":1000000,"income_tax_withheld":0}
        self.assertEqual(finish(2027,fields,"PDF_TEXT")["status"],"REQUIRES_REVIEW")
        self.assertEqual(finish(2026,fields,"IMAGE_OCR")["status"],"REQUIRES_REVIEW")

    def test_noninteger_income_year_cannot_be_rounded_by_excel(self):
        # JSON numbers such as 2025.6 and numeric-looking strings must not
        # become 2026 or 2025 when VBA calls CLng on a provisional bridge.
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/"synthetic.json"
            fields={"salary_gross":5000000,
                    "social_insurance":1000000,"income_tax_withheld":0}
            for invalid_year in (2025.6,2026.0,"2026",True):
                path.write_text(json.dumps({"schema":"furusato-withholding/v1",
                    "year":invalid_year,"fields":fields}),encoding="utf-8")
                report=extract(path)
                self.assertIsNone(report["year"])
                self.assertEqual(report["status"],"REQUIRES_REVIEW")
                self.assertIn("YEAR_NOT_APPROVED",report["warnings"])
                output=Path(tmp)/"bridge.tsv"
                write_bridge(report,output)
                self.assertEqual(output.read_text(encoding="utf-8")
                                 .splitlines()[1],"YEAR\t")
            path.write_text(json.dumps({"schema":"furusato-withholding/v1",
                "year":2026,"fields":fields}),encoding="utf-8")
            correct=extract(path)
            self.assertEqual(correct["year"],2026)
            self.assertEqual(correct["status"],"READY_FOR_EXCEL_CROSSCHECK")

    def test_vba_skips_warning_metadata_for_numeric_import(self):
        code = (Path(__file__).resolve().parents[1] / "vba" / "TaxLawUpdater.bas").read_text(encoding="utf-8")
        # Both the validation and the application loop must skip the
        # nonnumeric WARNINGS metadata before calling CDbl.
        safe_loop = 'If key <> "STATUS" And key <> "YEAR" And key <> "WARNINGS" Then'
        self.assertEqual(code.count(safe_loop), 2)
        self.assertIn('extra.Range("B20").Value2 = status', code)
        self.assertIn('extra.Range("B32").Value2 = fields("WARNINGS")', code)
        self.assertIn('Case "spouse_income_reference": extra.Range("B40").Value2 = value', code)
        self.assertIn('ValidateSpouseSource home, extra', code)
        # The unsupported source cannot be accepted by user acknowledgement.
        self.assertIn('InStr(1, CStr(extra.Range("B32").Value2), "UNSUPPORTED_"', code)
        self.assertIn("vbObjectError + 275", code)
        self.assertIn("Public Sub ReviewWithholding()", code)
        self.assertIn('If Trim$(CStr(fields("YEAR"))) <> CStr(year) Then',code)

    def test_provisional_pdf_bridge_contains_only_status_and_warning_codes(self):
        with TemporaryDirectory() as tmp:
            fields={"salary_gross":5000000,"salary_reference":3560000,
                    "deductions_reference":1500000,"social_insurance":1600000,
                    "income_tax_withheld":0,"mortgage_possible_credit":300000,
                    "mortgage_claim_count":1,"mortgage_occupancy_year":2024}
            data=finish(2026,fields,"PDF_TEXT")
            self.assertEqual(data["status"],"REQUIRES_REVIEW")
            self.assertIn("MORTGAGE_APPLIED_CREDIT_MISSING",data["warnings"])
            dest=Path(tmp)/"bridge.tsv"
            write_bridge(data,dest)
            contents=dest.read_text(encoding="utf-8")
            self.assertIn("STATUS\tREQUIRES_REVIEW",contents)
            self.assertIn("WARNINGS\t",contents)
            self.assertIn("mortgage_possible_credit\t300000",contents)
            self.assertNotIn("山田",contents)

    def test_json_schema_and_identifier_rejection(self):
        with TemporaryDirectory() as tmp:
            p=Path(tmp)/"input.json"
            p.write_text(json.dumps({"schema":"furusato-withholding/v1",
                "year":2025,"fields":{"salary_gross":7000000,
                "social_insurance":1000000,"income_tax_withheld":0,
                "full_name":"never_export"}}),encoding="utf-8")
            self.assertNotIn("full_name",extract(p)["fields"])

    def test_duplicate_structured_source_fields_fail_closed(self):
        # Entirely synthetic, no client PDF or identifying information in CI.
        with TemporaryDirectory() as tmp:
            for extension, header in ((".csv", "field,value"), (".tsv", "field\tvalue")):
                sep = "," if extension == ".csv" else "\t"
                for repeated in (7000000, 5000000):
                    source=Path(tmp)/("duplicate" + extension)
                    source.write_text(
                        header + "\n" +
                        "year" + sep + "2026\n" +
                        "salary_gross" + sep + "5000000\n" +
                        "salary_gross" + sep + str(repeated) + "\n" +
                        "social_insurance" + sep + "1000000\n" +
                        "income_tax_withheld" + sep + "0\n",encoding="utf-8")
                    with self.assertRaisesRegex(ValueError,"Duplicate structured field"):
                        extract(source)
            # A repeated year may otherwise switch to a different tax master.
            p=Path(tmp)/"duplicate-year.csv"
            p.write_text(
                "field,value\nyear,2025\nyear,2026\nsalary_gross,5000000\n"
                "social_insurance,1000000\nincome_tax_withheld,0\n",encoding="utf-8")
            with self.assertRaisesRegex(ValueError,"Duplicate structured field"):
                extract(p)

            # Reject extra CSV columns and malformed row lengths instead of
            # ignoring an unreviewed value or transferring a partial record.
            p=Path(tmp)/"malformed.csv"
            p.write_text("field,value,unknown\nyear,2026,ignored\n",encoding="utf-8")
            with self.assertRaisesRegex(ValueError,"Expected exactly field,value"):
                extract(p)
            p.write_text("field,value\nyear,2026,extra\n",encoding="utf-8")
            with self.assertRaisesRegex(ValueError,"Malformed structured row"):
                extract(p)

            # The shipped CLI must not emit a VBA bridge on rejected data.
            source=Path(tmp)/"duplicate.csv"
            source.write_text(
                "field,value\nyear,2026\nsalary_gross,5000000\n"
                "salary_gross,7000000\nsocial_insurance,1000000\n"
                "income_tax_withheld,0\n",encoding="utf-8")
            bridge=Path(tmp)/"provisional.tsv"
            output=Path(tmp)/"provisional.json"
            runner=subprocess.run(
                [sys.executable,str(Path(__file__).resolve().parent/
                 "withholding_reader.py"),"--input",str(source),
                 "--output",str(output),"--bridge",str(bridge)],
                capture_output=True,text=True)
            self.assertNotEqual(runner.returncode,0)
            self.assertIn("READ_ERROR_ValueError",runner.stderr)
            self.assertFalse(bridge.exists())
            self.assertFalse(output.exists())

    def test_duplicate_json_object_members_fail_closed(self):
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/"duplicate.json"
            cases=(
                '{"schema":"furusato-withholding/v1","year":2025,"year":2026,"fields":{}}',
                '{"schema":"furusato-withholding/v1","year":2026,"fields":'
                '{"salary_gross":5000000,"salary_gross":7000000}}',
                '{"schema":"furusato-withholding/v1","year":2026,"fields":{},'
                '"schema":"furusato-withholding/v1"}',
            )
            for source in cases:
                path.write_text(source,encoding="utf-8")
                with self.assertRaisesRegex(ValueError,"Duplicate JSON member"):
                    extract(path)

    def test_invalid_optional_structured_values_cannot_be_ignored(self):
        # Synthetic tax data only: invalid optional figures must fail closed,
        # not be silently omitted while the three required fields are valid.
        with TemporaryDirectory() as tmp:
            root=Path(tmp)
            good={"salary_gross":7000000,"social_insurance":1000000,
                  "income_tax_withheld":0}
            for invalid_field,value in (
                    ("life_deduction_reference","unknown"),
                    ("earthquake_deduction_reference",-1),
                    ("mortgage_credit",True),
                    ("salary_reference",7000000.5)):
                p=root/"input.json"
                p.write_text(json.dumps({"schema":"furusato-withholding/v1",
                    "year":2026,"fields":{**good,invalid_field:value}}),encoding="utf-8")
                parsed=extract(p)
                self.assertEqual(parsed["status"],"REQUIRES_REVIEW")
                self.assertIn("INVALID_STRUCTURED_FIELD",parsed["warnings"])
                self.assertNotIn(invalid_field,parsed["fields"])
                self.assertEqual(parsed["fields"]["salary_gross"],7000000)

            # JSON float year equals 2026 in Python comparisons, but is not
            # a valid integer tax-year attestation.
            p.write_text(json.dumps({"schema":"furusato-withholding/v1",
                "year":2026.0,"fields":good}),encoding="utf-8")
            parsed=extract(p)
            self.assertEqual(parsed["status"],"REQUIRES_REVIEW")
            self.assertIn("YEAR_NOT_APPROVED",parsed["warnings"])

            csv_path=root/"input.csv"
            csv_path.write_text(
                "field,value\nyear,2026\nsalary_gross,7000000\n"
                "social_insurance,1000000\nincome_tax_withheld,0\n"
                "life_deduction_reference,INVALID\n",encoding="utf-8")
            parsed=extract(csv_path)
            self.assertEqual(parsed["status"],"REQUIRES_REVIEW")
            self.assertIn("INVALID_STRUCTURED_FIELD",parsed["warnings"])
            self.assertNotIn("life_deduction_reference",parsed["fields"])
            bridge=root/"bridge.tsv"
            write_bridge(parsed,bridge)
            self.assertIn("STATUS\tREQUIRES_REVIEW",bridge.read_text(encoding="utf-8"))

    def test_invalid_labelled_optional_amount_never_disappears_silently(self):
        # A recognizable optional deduction may be illegible; this must
        # produce HOLD, not an apparently successful salary-only estimate.
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/"synthetic-labelled.txt"
            base=("令和 8 年分 給与所得の源泉徴収票\n"
                  "支払金額：7,000,000\n"
                  "社会保険料等の金額：1,000,000\n"
                  "源泉徴収税額：0\n")
            for unreadable in ("金額不明","10,000円",""):
                path.write_text(base+
                    "地震保険料の支払額："+unreadable+"\n",encoding="utf-8")
                report=extract(path)
                self.assertEqual(report["status"],"REQUIRES_REVIEW")
                self.assertIn("INVALID_LABELLED_earthquake_paid",report["warnings"])
                self.assertNotIn("earthquake_paid",report["fields"])
                self.assertEqual(report["fields"]["salary_gross"],7000000)
                bridge=Path(tmp)/"bridge.tsv"
                write_bridge(report,bridge)
                content=bridge.read_text(encoding="ascii")
                self.assertIn("STATUS\tREQUIRES_REVIEW",content)
                self.assertNotIn("earthquake_paid\t",content)
            # Identical amounts in a fully numeric document remain eligible.
            path.write_text(base+"地震保険料の支払額：10,000\n",encoding="utf-8")
            report=extract(path)
            self.assertEqual(report["status"],"READY_FOR_EXCEL_CROSSCHECK")
            self.assertEqual(report["fields"]["earthquake_paid"],10000)
            # If a known label becomes illegible after a readable duplicate,
            # no earlier value may be silently retained.
            path.write_text(base+
                "地震保険料の支払額：10,000\n"+
                "地震保険料の支払額：不明\n",encoding="utf-8")
            report=extract(path)
            self.assertEqual(report["status"],"REQUIRES_REVIEW")
            self.assertIn("INVALID_LABELLED_earthquake_paid",report["warnings"])
            self.assertNotIn("earthquake_paid",report["fields"])

    def test_conflicting_labelled_amounts_require_review(self):
        # A plain-text source without G-codes previously selected the last
        # value for a repeated label, which could hide an earlier conflict.
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/"synthetic.txt"
            base=("令和 8 年分 給与所得の源泉徴収票\n"
                  "社会保険料等の金額：1,000,000\n"
                  "源泉徴収税額：0\n")
            path.write_text(base+
                            "支払金額：5,000,000\n"
                            "支払金額：7,000,000\n",encoding="utf-8")
            result=extract(path)
            self.assertEqual(result["status"],"REQUIRES_REVIEW")
            self.assertIn("CONFLICT_salary_gross",result["warnings"])
            self.assertNotIn("salary_gross",result["fields"])
            # Repeated identical data is not itself contradictory.
            path.write_text(base+
                            "支払金額：5,000,000\n"
                            "支払金額：5,000,000\n",encoding="utf-8")
            same=extract(path)
            self.assertEqual(same["status"],"READY_FOR_EXCEL_CROSSCHECK")
            self.assertEqual(same["fields"]["salary_gross"],5000000)
            self.assertNotIn("CONFLICT_salary_gross",same["warnings"])

    def test_verified_mortgage_applied_credit_zero_withholding_is_comparable(self):
        # SYNTHETIC source-only example. A mortgage credit is NOT a blanket
        # reason for withholding-tax reconciliation to fail closed. Its
        # current-year resident-tax / donation effects are separate checks.
        numbers = {
            "salary_gross": 7_000_000,
            "salary_reference": 5_200_000,
            "deductions_reference": 1_600_000,
            "social_insurance": 1_000_000,
            "income_tax_withheld": 0,
            "mortgage_credit": 292_500,
            "mortgage_possible_credit": 350_000,
            "mortgage_claim_count": 1,
            "mortgage_occupancy_year": 2024,
        }
        source = finish(2025, numbers, "PDF_TEXT")
        self.assertEqual(source["status"], "READY_FOR_EXCEL_CROSSCHECK")
        verified = reconcile(2025, source["fields"])
        self.assertEqual(verified["source_tax"], "MATCH")
        self.assertEqual(verified["donation_limit"], "NOT_VERIFIED")
        self.assertEqual(verified["reason"], "YEAR_END_SALARY_TAX_MODEL")
        # The applied credit (G29) cannot be guessed from the possible
        # credit (G36), nor reused as next year's applied credit.
        for missing in ("mortgage_credit", "mortgage_occupancy_year"):
            incomplete = dict(numbers)
            incomplete.pop(missing)
            with self.subTest(missing=missing):
                held = finish(2025, incomplete, "PDF_TEXT")
                self.assertEqual(held["status"], "REQUIRES_REVIEW")
        invalid = finish(2025, {**numbers, "mortgage_credit": 360_000}, "PDF_TEXT")
        self.assertEqual(invalid["status"], "REQUIRES_REVIEW")
        self.assertIn("MORTGAGE_APPLIED_EXCEEDS_POSSIBLE", invalid["warnings"])

    def test_housing_occupancy_and_credit_differ(self):
        self.assertEqual(extract_occupancy_year("控除の額の内訳 1回目N01 令和 6 1 1 1回目G37"),
                         {"mortgage_occupancy_year":2024})
        base={"salary_gross":5000000,"salary_reference":3560000,
              "deductions_reference":3956000,"social_insurance":1600000,
              "income_tax_withheld":0,"mortgage_claim_count":1,
              "mortgage_possible_credit":300000,"mortgage_occupancy_year":2024}
        flagged=finish(2026,base,"PDF_TEXT")
        self.assertEqual(flagged["status"],"READY_FOR_EXCEL_CROSSCHECK")
        self.assertIn("MORTGAGE_ZERO_FROM_ZERO_TAXABLE_INCOME",flagged["warnings"])
        self.assertEqual(flagged["fields"]["mortgage_credit"],0)
        self.assertEqual(flagged["fields"]["mortgage_possible_credit"],300000)
        safe=finish(2026,{**base,"mortgage_credit":50000},"PDF_TEXT")
        self.assertEqual(safe["status"],"READY_FOR_EXCEL_CROSSCHECK")
        too_high=finish(2026,{**base,"mortgage_credit":400000},"PDF_TEXT")
        self.assertIn("MORTGAGE_APPLIED_EXCEEDS_POSSIBLE",too_high["warnings"])
        self.assertEqual(finish(2026,{**base,"mortgage_credit":0,"mortgage_claim_count":2},
                                "PDF_TEXT")["status"],"REQUIRES_REVIEW")
        taxable={**base,"deductions_reference":1100000}
        self.assertIn("MORTGAGE_APPLIED_CREDIT_MISSING",
                      finish(2026,taxable,"PDF_TEXT")["warnings"])

    def test_reiwa8_g72_g73_g74_are_distinct(self):
        # Anonymous coordinates model the 2026 form, not any private document.
        words=[
            (380,265,391,271,"G72"),(395,264,402,271,"1"),
            (408,265,419,271,"G73"),
            (435,265,446,271,"G20"),(451,264,458,271,"2"),
            (33,300,44,305,"G74"),(102,296,138,305,"630,000"),
        ]
        self.assertEqual(CODE_MAP["G72"],"special_relative_count")
        self.assertEqual(CODE_MAP["G20"],"under16_count")
        self.assertNotIn("G73",CODE_MAP)
        self.assertEqual(CODE_MAP["G74"],"special_relative_deduction_reference")
        fields,flags=extract_codes(words)
        self.assertEqual(flags,[])
        self.assertEqual(fields,{
            "special_relative_count":1,
            "under16_count":2,
            "special_relative_deduction_reference":630000,
        })
        source={**fields,"salary_gross":5000000,
                "salary_reference":3560000,"deductions_reference":3956000,
                "social_insurance":1600000,"income_tax_withheld":0}
        report=finish(2026,source,"PDF_TEXT")
        self.assertEqual(report["status"],"REQUIRES_REVIEW")
        self.assertIn("SPECIAL_RELATIVE_REQUIRES_INCOME_DETAILS",report["warnings"])
        self.assertNotIn("SPECIAL_RELATIVE_COUNT_MISSING",report["warnings"])

    def test_2025_under16_and_special_relative_secondary_are_distinct(self):
        # Synthetic count data and anchor coordinates; never private originals.
        words=[
            (408,265,419,271,"G73"),
            (435,265,446,271,"G20"),(451,264,458,271,"4"),
        ]
        fields,flags=extract_codes(words)
        self.assertEqual(fields,{"under16_count":4})
        self.assertEqual(flags,[])
        words.insert(1,(423,264,430,271,"1"))
        fields,flags=extract_codes(words)
        self.assertEqual(fields,{"under16_count":4})
        self.assertIn("UNSUPPORTED_SPECIAL_RELATIVE_SUBORDINATE_COUNT",flags)
        source={"salary_gross":5000000,
                "social_insurance":800000,"income_tax_withheld":0,**fields}
        report=finish(2025,source,"PDF_TEXT",flags)
        self.assertEqual(report["status"],"REQUIRES_REVIEW")
        self.assertIn("UNSUPPORTED_SPECIAL_RELATIVE_SUBORDINATE_COUNT",
                      report["warnings"])
        self.assertNotIn("special_relative_subordinate_count",report["fields"])

    def test_special_relative_amount_without_count_requires_review(self):
        source={"salary_gross":5000000,"social_insurance":1000000,
                "income_tax_withheld":0,
                "special_relative_deduction_reference":630000}
        report=finish(2026,source,"PDF_TEXT")
        self.assertEqual(report["status"],"REQUIRES_REVIEW")
        self.assertIn("SPECIAL_RELATIVE_COUNT_MISSING",report["warnings"])
        with TemporaryDirectory() as tmp:
            dest=Path(tmp)/"bridge.tsv"
            write_bridge(report,dest)
            payload=dest.read_text(encoding="utf-8")
            self.assertIn("special_relative_deduction_reference"+chr(9)+"630000",payload)
            self.assertNotIn("山田",payload)

    def test_four_special_relatives_require_personal_review_not_old_three_person_limit(self):
        values={"salary_gross":7000000,"income_tax_withheld":285800,
                "social_insurance":1000000,
                "special_relative_count":4,
                "special_relative_deduction_reference":1360000}
        report=finish(2026,values,"STRUCTURED_JSON")
        self.assertEqual(report["status"],"REQUIRES_REVIEW")
        self.assertIn("SPECIAL_RELATIVE_REQUIRES_INCOME_DETAILS",report["warnings"])
        self.assertNotIn("SPECIAL_RELATIVE_COUNT_EXCEEDS_UI",report["warnings"])
        values["special_relative_count"]=31
        report=finish(2026,values,"STRUCTURED_JSON")
        self.assertIn("SPECIAL_RELATIVE_COUNT_EXCEEDS_UI",report["warnings"])

    def test_special_relative_vba_bridge_contract(self):
        root=Path(__file__).resolve().parents[1]
        code=(root/"vba"/"TaxLawUpdater.bas").read_text(encoding="utf-8")
        self.assertIn('Case "special_relative_count": extra.Range("B38").Value2 = value',code)
        self.assertIn('Case "special_relative_deduction_reference": extra.Range("B39").Value2 = value',code)
        self.assertIn("Public Function SpecialRelativeTaxDeduction(",code)
        self.assertIn('extra.Range("B38:B40").ClearContents',code)
        self.assertIn('ValidateSpecialRelativeSource home, extra, relatives',code)
        self.assertIn('Public Function SpecialRelativeSourceCheckForTest() As String',code)
        self.assertIn('If actualCount <> sourceCount Then',code)
        self.assertIn('If actualAmount <> sourceAmount Then',code)
        self.assertIn('If statutory <> CDbl(relatives.Cells(row, "E").Value2) Then',code)
        self.assertIn('For row = 4 To 8',code)
        self.assertIn('If Not hasSourceCount And Not hasSourceAmount Then Exit Sub',code)
        self.assertIn('If sourceCount > 0 And Not hasSourceAmount Then',code)
        self.assertNotIn('If sourceCount = 0 Then Exit Sub',code)


if __name__=="__main__":
    unittest.main(verbosity=2)
