"""Synthetic parser tests: no actual personal documents in git or CI."""
import json
import runpy
import sys
from unittest.mock import patch
from types import SimpleNamespace
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from withholding_reader import CODE_MAP,detect_year,extract_codes,extract_labelled,extract_occupancy_year,extract,finish,write_bridge,extract_pdf_batch,write_batch_bridge,pdf_page_count,family_transfer_warnings


class WithholdingTest(unittest.TestCase):
    def test_page_probe_is_structure_only_and_returns_no_personal_text(self):
        # Simulated PDF is five-page and contains no actual taxpayer data.
        # The probe must not call get_text/get_pixmap/get_textpage.
        class HeaderOnlyPDF:
            is_encrypted = False
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def __len__(self): return 5
            def __getitem__(self, idx):
                raise AssertionError("Probe must never open a PDF page")
        with TemporaryDirectory() as tmp:
            inp = Path(tmp) / "fictional_five_people.pdf"
            output = Path(tmp) / "private_count.txt"
            inp.write_bytes(b"synthetic-placeholder-pdf-not-a-real-document")
            fake = SimpleNamespace(open=lambda path: HeaderOnlyPDF())
            with patch.dict("sys.modules", {"fitz": fake}):
                self.assertEqual(pdf_page_count(inp), 5)
                args = ["withholding_reader.py","--input",str(inp),
                        "--output",str(output),"--probe-pages"]
                with patch.object(sys,"argv",args):
                    runpy.run_path(str(Path(__file__).with_name("withholding_reader.py")),
                                   run_name="__main__")
            self.assertEqual(output.read_bytes(), b"PDF_PAGES\t5\n")
            self.assertNotIn(b"salary",output.read_bytes())
            self.assertNotIn(b"personal",output.read_bytes())
        vba = (Path(__file__).parent.parent / "vba" /
               "TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        self.assertIn("PdfPagesForImport", vba)
        self.assertIn("--batch-bridge", vba)
        self.assertIn("If pageCount > 1 Then", vba)
        self.assertIn("BatchWithholding.BatchImportBridgeLocalFile(tempProbe)", vba)
        self.assertIn("BatchWithholding.ShowBatch", vba)
        self.assertIn("GoTo CleanUp",vba)

    def test_page_probe_rejects_encrypted_pdf(self):
        class Encrypted:
            is_encrypted = True
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def __len__(self): return 5
        with TemporaryDirectory() as tmp:
            inp = Path(tmp) / "fictional_encrypted.pdf"
            inp.write_bytes(b"not-actual-pdf")
            with patch.dict("sys.modules",{"fitz":SimpleNamespace(open=lambda _:Encrypted())}):
                with self.assertRaisesRegex(ValueError,"PDF_PAGE_PROBE_UNSUPPORTED"):
                    pdf_page_count(inp)

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

    def test_family_tax_slip_fields_are_not_silently_ignored(self):
        # Exact anonymous G-field slots, matching the 2025/26 tax form.
        ordered = ("G09","G10","G11","G12","G13","G14","G15","G16",
                   "G17","G18","G19","G20","G21","G22","G23","G24")
        def form(**amounts):
            words = []
            for idx, code in enumerate(ordered):
                x = 23 + idx * 37
                words.append((x,260,x+16,268,code))
                value = amounts.get(code, 2 if code in ("G09","G10","G11") else 0)
                words.append((x+22,260,x+34,268,str(value)))
            return words
        baseline = form()
        self.assertEqual(family_transfer_warnings(baseline), [])
        self.assertEqual(family_transfer_warnings(form(G18=1)), [])
        self.assertEqual(family_transfer_warnings(form(G09=1,G12=380000)), [])
        self.assertEqual(family_transfer_warnings(form(G13=2,G15=1,G16=2)), [])
        self.assertEqual(family_transfer_warnings(form(G09=2,G12=380000)),
                         ["FAMILY_SPOUSE_INCOME_NEEDED"])
        self.assertEqual(family_transfer_warnings(form(G21=2,G22=1)),
                         ["FAMILY_DISABLED_SUBCOUNT_INVALID"])
        self.assertEqual(family_transfer_warnings(form(G14=1)),
                         ["FAMILY_SECONDARY_OR_NONRESIDENT_REQUIRES_REVIEW"])
        self.assertEqual(family_transfer_warnings(form(G24=1)),
                         ["FAMILY_SECONDARY_OR_NONRESIDENT_REQUIRES_REVIEW"])
        self.assertEqual(family_transfer_warnings([(435,265,446,271,"G20")]),
                         ["FAMILY_LAYOUT_UNVERIFIED"])
        fields, flags = extract_codes(form(G20=2,G13=1))
        self.assertEqual(flags, [])
        self.assertEqual(fields["under16_count"], 2)
        self.assertEqual(fields["specific_dependent_count"], 1)
        self.assertEqual(CODE_MAP["G73"],"secondary_special_relative_count")
        self.assertNotEqual(CODE_MAP["G73"],"under16_count")
        # A source with no reconstructable family row must be HOLD, never
        # read as 'no spouse and no dependents' without evidence.
        base = {"salary_gross":5000000,"salary_reference":3500000,
                "deductions_reference":1500000,"income_tax_withheld":100000,
                "social_insurance":800000}
        unsafe = finish(2025,base,"PDF_TEXT",family_transfer_warnings([]))
        self.assertEqual(unsafe["status"],"REQUIRES_REVIEW")
        self.assertIn("FAMILY_LAYOUT_UNVERIFIED",unsafe["warnings"])
        with TemporaryDirectory() as tmp:
            path=Path(tmp)/"fictional_family_warning.tsv"
            write_batch_bridge([{"page":1,**unsafe}],path)
            self.assertTrue(path.read_bytes().isascii())
            self.assertIn(b"FAMILY_LAYOUT_UNVERIFIED",path.read_bytes())


    def test_labelled(self):
        self.assertEqual(extract_labelled("支払金額：5,000,000\n社会保険料等の金額：1,000,000"),
                         {"salary_gross":5000000,"social_insurance":1000000})

    def test_private_multi_page_pdf_separates_taxpayers_and_disposes_identifiers(self):
        # Entirely synthetic pages: do not place actual source slips in CI.
        class FakePage:
            def __init__(self, text):
                self.text = text
            def get_text(self, mode, sort=False):
                return [] if mode == "words" else self.text

        class FakeDoc:
            is_encrypted = False
            def __init__(self, pages):
                self.pages = [FakePage(p) for p in pages]
            def __len__(self):
                return len(self.pages)
            def __iter__(self):
                return iter(self.pages)
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False

        fictional = [
            "令和 7 年分 給与所得の源泉徴収票\n"
            "氏名：SYNTHETIC_PERSON_ONE\n住所：SYNTHETIC_ADDRESS\n"
            "支払金額：7,000,000\n給与所得控除後の金額：5,200,000\n"
            "所得控除の額の合計額：1,670,000\n源泉徴収税額：500,000\n"
            "社会保険料等の金額：1,000,000\n",
            "令和 8 年分 給与所得の源泉徴収票\n"
            "氏名：SYNTHETIC_PERSON_TWO\n勤務先：SYNTHETIC_EMPLOYER\n"
            "支払金額：5,000,000\n給与所得控除後の金額：3,560,000\n"
            "所得控除の額の合計額：1,400,000\n源泉徴収税額：80,000\n"
            "社会保険料等の金額：850,000\n",
        ]
        with TemporaryDirectory() as tmp:
            file = Path(tmp) / "fictional_2_slips.pdf"
            file.write_bytes(b"test-only-placeholder-PDF-content")
            fake_fitz = SimpleNamespace(open=lambda path: FakeDoc(fictional))
            with patch.dict("sys.modules", {"fitz": fake_fitz}):
                records = extract_pdf_batch(file)
            self.assertEqual([x["page"] for x in records], [1, 2])
            self.assertEqual([x["year"] for x in records], [2025, 2026])
            self.assertEqual(records[0]["fields"]["salary_gross"], 7000000)
            self.assertEqual(records[1]["fields"]["salary_gross"], 5000000)
            self.assertEqual(records[0]["fields"]["social_insurance"], 1000000)
            self.assertEqual(records[1]["fields"]["social_insurance"], 850000)
            output = Path(tmp) / "batch.tsv"
            write_batch_bridge(records, output)
            raw = output.read_bytes()
            self.assertTrue(raw.isascii(), "bridge must be ASCII-only")
            self.assertIn(b"PAGE\t1\n", raw)
            self.assertIn(b"ENDPAGE\t1\nPAGE\t2\n", raw)
            self.assertIn(b"salary_gross\t7000000\n", raw)
            self.assertIn(b"salary_gross\t5000000\n", raw)
            self.assertNotIn(b"SYNTHETIC_PERSON", raw)
            self.assertNotIn(b"ADDRESS", raw)
            self.assertNotIn(b"EMPLOYER", raw)
            report = str(records)
            self.assertNotIn("SYNTHETIC_PERSON", report)

    def test_five_page_2025_batch_preserves_blank_social_and_housing_fields(self):
        # A completely fictional five-page PDF model. No actual financial
        # amounts or identifiers are copied from the user's source PDF.
        def tokens(gross, salary, deductions, withheld, social):
            cells = [
                ((104, 218, 115, 223, "G04"),
                 (178, 215, 233, 226, f"{gross:,}")),
                ((231, 209, 242, 215, "G05"),
                 (289, 207, 344, 218, f"{salary:,}")),
                ((341, 209, 352, 215, "G06"),
                 (398, 207, 453, 218, f"{deductions:,}")),
                ((452, 218, 463, 223, "G08"),
                 (533, 215, 560, 224, f"{withheld:,}")),
            ]
            if social is not None:
                cells.append(((138, 308, 149, 314, "G26"),
                              (215, 305, 260, 314, f"{social:,}")))
            else:
                # The next column is a life-insurance deduction, NOT social
                # insurance. An absent G26 must not borrow a G27 value.
                cells.extend([
                    ((138, 308, 149, 314, "G26"),),
                    ((300, 308, 311, 314, "G27"),
                     (365, 305, 410, 314, "42,000")),
                ])
            # Mock the 2025/26 anonymized family-code row. Checkbox
            # values 2 mean unchecked; other numbered slots are empty/zero.
            for idx, code in enumerate(("G09","G10","G11","G12","G13","G14",
                                         "G15","G16","G17","G18","G19","G20",
                                         "G21","G22","G23","G24")):
                x=20+idx*36
                value=2 if code in ("G09","G10","G11") else 0
                cells.append(((x,265,x+17,273,code),
                              (x+23,265,x+33,273,str(value))))
            return [w for pair in cells for w in pair]

        fixtures = [
            (6900000, 5000000, 1800000, 140000, 950000),
            (5100000, 3560000, 1500000, 0, 740000),
            (3900000, 2600000, 1250000, 35000, 580000),
            (1200000, 550000, 740000, 0, None),
            (3400000, 2300000, 1140000, 46000, 415000),
        ]

        class Page:
            def __init__(self, ordinal, entry):
                self.ordinal = ordinal
                self.words = tokens(*entry)
                self.text = (
                    "令和 7 年分\n"
                    "源泉徴収票の架空レイアウト検証用であり"
                    "実際の納税者の記載事項は含まれていません\n"
                )
            def get_text(self, kind, sort=False):
                return self.words if kind == "words" else self.text

        class Document:
            is_encrypted = False
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def __len__(self):
                return len(fixtures)
            def __iter__(self):
                return iter(Page(i, x) for i, x in enumerate(fixtures, 1))

        with TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "synthetic_five_taxpayers.pdf"
            pdf.write_bytes(b"synthetic-pdf-mock")
            fitz_fake = SimpleNamespace(open=lambda _: Document())
            with patch.dict("sys.modules", {"fitz": fitz_fake}):
                pages = extract_pdf_batch(pdf)
            self.assertEqual(len(pages), 5)
            self.assertEqual([x["year"] for x in pages], [2025] * 5)
            self.assertEqual([x["status"] for x in pages], [
                "READY_FOR_EXCEL_CROSSCHECK",
                "READY_FOR_EXCEL_CROSSCHECK",
                "READY_FOR_EXCEL_CROSSCHECK",
                "REQUIRES_REVIEW",
                "READY_FOR_EXCEL_CROSSCHECK",
            ])
            self.assertNotIn("social_insurance", pages[3]["fields"])
            self.assertEqual(pages[3]["fields"]["life_deduction_reference"], 42000)
            self.assertEqual(pages[4]["fields"]["social_insurance"], 415000)
            self.assertNotEqual(
                pages[0]["fields"]["salary_gross"],
                pages[1]["fields"]["salary_gross"],
                "never reuse a previous taxpayer's income"
            )
            destination = Path(tmp) / "safe_page_bridge.tsv"
            write_batch_bridge(pages, destination)
            content = destination.read_bytes()
            self.assertEqual(sum(line.startswith(b"PAGE\t") for line in content.splitlines()), 5)
            self.assertIn(b"ENDPAGE\t4\nPAGE\t5\n", content)
            page4 = content.split(b"PAGE\t4\n", 1)[1].split(b"ENDPAGE\t4\n", 1)[0]
            self.assertNotIn(b"social_insurance\t", page4)
            self.assertIn(b"life_deduction_reference\t42000", page4)
            self.assertIn(b"STATUS\tREQUIRES_REVIEW", page4)
            self.assertNotIn(b"name", content.lower())
            self.assertTrue(content.isascii())

    def test_ambiguous_code_stays_per_page_hold_without_bridge_failure(self):
        # An ambiguous numeric field must not abort all taxpayers' import.
        tokens = [
            (104, 218, 115, 223, "G04"),
            (178, 215, 233, 226, "5,000,000"),
            (237, 215, 263, 226, "5,100,000"),
        ]
        fields, warnings = extract_codes(tokens)
        self.assertNotIn("salary_gross", fields)
        self.assertEqual(warnings, ["AMBIGUOUS_SALARY_GROSS"])
        hold = finish(2025, fields, "PDF_TEXT", warnings)
        self.assertEqual(hold["status"], "REQUIRES_REVIEW")
        with TemporaryDirectory() as tmp:
            dest = Path(tmp) / "ambiguous.tsv"
            write_batch_bridge([{"page": 1, **hold}], dest)
            output = dest.read_bytes()
            self.assertTrue(output.isascii())
            self.assertIn(b"AMBIGUOUS_SALARY_GROSS", output)
            self.assertNotIn(b"salary_gross\t", output)

    def test_batch_rejects_wrong_page_count_and_unsafe_bridge_values(self):
        with TemporaryDirectory() as tmp:
            file = Path(tmp) / "fictional_slips.pdf"
            file.write_bytes(b"synthetic-local-input")
            fake_fitz = SimpleNamespace(
                open=lambda _: type("InvalidDoc", (), {
                    "is_encrypted":False,
                    "__enter__":lambda self: self,
                    "__exit__":lambda self,*args:False,
                    "__len__":lambda self:21
                })()
            )
            with patch.dict("sys.modules", {"fitz":fake_fitz}):
                with self.assertRaises(ValueError):
                    extract_pdf_batch(file)
            valid = finish(2025,{
                "salary_gross":5000000,
                "salary_reference":3560000,
                "deductions_reference":1400000,
                "social_insurance":850000,
                "income_tax_withheld":80000,
            }, "PDF_TEXT")
            with self.assertRaises(ValueError):
                write_batch_bridge([{"page":2, **valid}],Path(tmp)/"wrong.tsv")
            with self.assertRaises(ValueError):
                write_batch_bridge([{"page":1, **valid,
                                     "warnings":["NAME:\tBAD"]}],
                                   Path(tmp)/"unsafe.tsv")

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
            (408,265,419,271,"G73"),(423,264,430,271,"2"),
            (435,265,446,271,"G20"),(451,264,458,271,"2"),
            (33,300,44,305,"G74"),(102,296,138,305,"630,000"),
        ]
        self.assertEqual(CODE_MAP["G72"],"special_relative_count")
        self.assertEqual(CODE_MAP["G20"],"under16_count")
        self.assertNotIn("G73",CODE_MAP)  # secondary special-relative count, not under16
        self.assertEqual(CODE_MAP["G74"],"special_relative_deduction_reference")
        fields,flags=extract_codes(words)
        self.assertEqual(flags,[])
        self.assertIn("FAMILY_DEDUCTION_NOT_TRANSFERRED",
                      family_transfer_warnings(words))
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

    def test_special_relative_vba_bridge_contract(self):
        root=Path(__file__).resolve().parents[1]
        code=(root/"vba"/"TaxLawUpdater.bas").read_text(encoding="utf-8")
        self.assertIn('Case "special_relative_count": extra.Range("B38").Value2 = value',code)
        self.assertIn('Case "special_relative_deduction_reference": extra.Range("B39").Value2 = value',code)
        self.assertIn("Public Function SpecialRelativeTaxDeduction(",code)
        self.assertIn('extra.Range("B38:B39").ClearContents',code)
        self.assertIn('If specialCount <> CLng(extra.Range("B38").Value2) Then',code)
        self.assertIn('Abs(specialTotal - CDbl(extra.Range("B39").Value2))',code)


if __name__=="__main__":
    unittest.main(verbosity=2)
