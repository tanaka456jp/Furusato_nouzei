"""Synthetic parser tests: no actual personal documents in git or CI."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from withholding_reader import detect_year,extract_codes,extract_labelled,extract_occupancy_year,extract,finish,write_bridge


class WithholdingTest(unittest.TestCase):
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


if __name__=="__main__":
    unittest.main(verbosity=2)
