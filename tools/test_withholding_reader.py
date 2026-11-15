"""Synthetic parser tests: no actual personal documents in git or CI."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess
import sys
import unittest
from withholding_reader import CODE_MAP,detect_year,extract_codes,extract_labelled,extract_occupancy_year,extract,finish,write_bridge,pdf_page_count


class WithholdingTest(unittest.TestCase):
    def test_multiple_pdf_pages_require_explicit_selection_and_review(self):
        # Two different, synthetic taxpayers in one PDF. No private documents.
        try:
            import fitz
        except ImportError:
            # The minimal Windows compatibility job intentionally omits
            # PyMuPDF. Dedicated static and packaged EXE jobs execute
            # this real parser test with the pinned PDF dependency.
            self.skipTest("PyMuPDF PDF-page test runs in parser/EXE jobs")
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
        try:
            import fitz
        except ImportError:
            self.skipTest("PyMuPDF smoke runs in document-reader EXE jobs")
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

    def test_years(self):
        self.assertEqual(detect_year("令和 8 年分 給与所得の源泉徴収票"),2026)
        self.assertEqual(detect_year("令和 7 年分"),2025)
        self.assertIsNone(detect_year("令和 7 年分 令和 8 年分"))

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

    def test_vba_skips_warning_metadata_for_numeric_import(self):
        code = (Path(__file__).resolve().parents[1] / "vba" / "TaxLawUpdater.bas").read_text(encoding="utf-8")
        # Both the validation and the application loop must skip the
        # nonnumeric WARNINGS metadata before calling CDbl.
        safe_loop = 'If key <> "STATUS" And key <> "YEAR" And key <> "WARNINGS" Then'
        self.assertEqual(code.count(safe_loop), 2)
        self.assertIn('extra.Range("B20").Value2 = status', code)
        self.assertIn('extra.Range("B32").Value2 = fields("WARNINGS")', code)
        # The unsupported source cannot be accepted by user acknowledgement.
        self.assertIn('InStr(1, CStr(extra.Range("B32").Value2), "UNSUPPORTED_"', code)
        self.assertIn("vbObjectError + 275", code)
        self.assertIn("Public Sub ReviewWithholding()", code)

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
        self.assertIn('extra.Range("B38:B39").ClearContents',code)
        self.assertIn('ValidateSpecialRelativeSource home, extra, relatives',code)
        self.assertIn('Public Function SpecialRelativeSourceCheckForTest() As String',code)
        self.assertIn('If actualCount <> sourceCount Then',code)
        self.assertIn('If actualAmount <> sourceAmount Then',code)
        self.assertIn('If statutory <> CDbl(relatives.Cells(row, "E").Value2) Then',code)
        self.assertIn('For row = 4 To 33',code)
        self.assertIn('If Not hasSourceCount And Not hasSourceAmount Then Exit Sub',code)
        self.assertIn('If sourceCount > 0 And Not hasSourceAmount Then',code)
        self.assertNotIn('If sourceCount = 0 Then Exit Sub',code)


if __name__=="__main__":
    unittest.main(verbosity=2)
