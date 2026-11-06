"""Static preservation, input wiring and independent synthetic reference amounts."""
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from openpyxl import load_workbook
from build_workbook import ROOT, HOME, ENGINE, DETAIL, RESIDENT, build


class WorkbookTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = TemporaryDirectory()
        cls.addClassCleanup(cls.work.cleanup)
        cls.source = ROOT / "workbook/baseline.xlsx"
        cls.target = Path(cls.work.name) / "review.xlsx"
        build(cls.source, cls.target)
        cls.baseline = load_workbook(cls.source)
        cls.book = load_workbook(cls.target)

    def test_single_visible_home(self):
        self.assertEqual(self.book.active.title, HOME)
        self.assertEqual([s.title for s in self.book if s.sheet_state == "visible"], [HOME])
        self.assertEqual(self.book[DETAIL].sheet_state, "veryHidden")
        with ZipFile(self.target) as archive:
            self.assertIsNone(archive.testzip())
            self.assertFalse(any(n.startswith(("xl/externalLinks/", "xl/vbaProject")) for n in archive.namelist()))

    def test_a4_single_page_layout_and_legible_status(self):
        for name in (HOME, DETAIL):
            sheet = self.book[name]
            self.assertEqual(str(sheet.page_setup.paperSize), str(sheet.PAPERSIZE_A4))
            self.assertEqual(sheet.page_setup.orientation, "portrait")
            self.assertTrue(sheet.sheet_properties.pageSetUpPr.fitToPage)
            self.assertEqual(sheet.page_setup.fitToWidth, 1)
            self.assertEqual(sheet.page_setup.fitToHeight, 1)
            self.assertTrue(sheet.print_options.horizontalCentered)
            self.assertFalse(sheet.print_options.gridLines)
            self.assertLess(sheet.page_margins.left, 0.4)
            self.assertLess(sheet.page_margins.right, 0.4)
        self.assertEqual(str(self.book[HOME].print_area), "'操作画面'!$A$1:$D$31")
        self.assertEqual(str(self.book[DETAIL].print_area), "'計算根拠'!$A$1:$D$15")
        rules = self.book[HOME].conditional_formatting
        self.assertIn("A9:D9", {str(r.sqref) for r in rules})
        self.assertGreaterEqual(len(rules["A9:D9"]), 2)
        self.assertGreaterEqual(self.book[HOME].row_dimensions[9].height, 36)

    def test_overlapping_source_merges_are_repaired_without_formula_changes(self):
        original = self.baseline[ENGINE]
        built = self.book[ENGINE]
        old = {str(r) for r in original.merged_cells.ranges}
        merged = {str(r) for r in built.merged_cells.ranges}
        self.assertIn("A71:I71", old)
        self.assertIn("E71:F71", old)
        self.assertIn("A71:I71", merged)
        self.assertNotIn("E71:F71", merged)
        self.assertEqual(built["A71"].value, original["A71"].value)
        self.assertEqual(built["J71"].value, original["J71"].value)
        self.assertEqual(built["J71"].data_type, "f")
        for sheet in self.book:
            ranges = list(sheet.merged_cells.ranges)
            for i, left in enumerate(ranges):
                for right in ranges[i + 1:]:
                    self.assertFalse(
                        left.min_row <= right.max_row
                        and right.min_row <= left.max_row
                        and left.min_col <= right.max_col
                        and right.min_col <= left.max_col,
                        f"Overlapping merges on {sheet.title}: {left} vs {right}"
                    )

    def test_unchanged_master_and_52_fixtures(self):
        for old in self.baseline:
            if not old.title.startswith("年度"):
                continue
            self.assertEqual(list(self.book[old.title].values), list(old.values), old.title)
        old = self.baseline["自動回帰テスト"]
        new = self.book[old.title]
        for row in old:
            for cell in row:
                if cell.coordinate != "B49":
                    self.assertEqual(new[cell.coordinate].value, cell.value)
        verdicts = [f"H{i}" for i in range(4, 46)] + [f"D{i}" for i in range(58, 64)] + [f"H{i}" for i in range(66, 70)]
        self.assertEqual(len(verdicts), 52)
        self.assertTrue(all(new[address].data_type == "f" for address in verdicts))
        self.assertIn("=52", new["B49"].value)

    def test_gate_applies_to_all_public_amounts(self):
        for address in ("B8", "D8"):
            self.assertIn('B28<>"正常"', self.book[HOME][address].value)
        for row in range(5, 15):
            self.assertIn("'操作画面'!B28=\"正常\"", self.book[DETAIL][f"B{row}"].value)
        self.assertIn("'操作画面'!B28=\"正常\"", self.book[RESIDENT]["B26"].value)
        for sheet in self.book:
            for row in sheet:
                for cell in row:
                    if cell.data_type == "f":
                        self.assertNotIn("#REF!", cell.value, f"{sheet.title}!{cell.coordinate}")

    def test_auto_income_and_deductions_and_no_one_stop_attestation(self):
        home = self.book[HOME]
        for address in ("B13", "B14", "B17", "B18"):
            self.assertEqual(home[address].data_type, "f")
            self.assertTrue(home[address].protection.locked)
        self.assertIn("'源泉徴収票入力'!B34", home["B13"].value)
        self.assertIn("'ふるさと納税限度額計算'!F24", home["B17"].value)
        self.assertIn("'ふるさと納税限度額計算'!F25", home["B18"].value)
        self.assertEqual(home["D24"].value, "確定申告")
        self.assertIsNone(home["D25"].value)
        self.assertNotIn('D25<>"確認済"', home["B28"].value)

    def test_no_customer_values_in_main_inputs(self):
        home = self.book[HOME]
        user_fields = ["B11", "B12", "B15", "B16"] + [
            f"B{i}" for i in range(19, 27)
        ] + [f"D{i}" for i in range(11, 24)]
        for cell in user_fields:
            self.assertIsNone(home[cell].value, cell)
            self.assertFalse(home[cell].protection.locked, cell)
            self.assertTrue(any(cell in rule for rule in home.data_validations.dataValidation), cell)

    def test_optional_numeric_fields_do_not_cause_fraction_gate_failures(self):
        formula = self.book[HOME]["B28"].value
        for group in ("B12:B24", "D11:D21", "D23"):
            self.assertIn(
                f"SUMPRODUCT(--(IFERROR(MOD({group},1),0)<>0))>0", formula
            )
            self.assertNotIn(
                f"IFERROR(MOD({group},1)<>0,TRUE)", formula
            )
        self.assertIn("COUNTA(B12:B24)<>COUNT(B12:B24)", formula)
        self.assertIn('COUNTIF(B12:B24,"<0")', formula)

    def test_independent_standard_salary_reference(self):
        # Single taxpayer, standard 10% residence tax, synthetic salary of ¥7m.
        taxable_resident = 5_200_000 - 1_000_000 - 430_000
        after_adjustment = taxable_resident // 10 - 2_500
        self.assertEqual(after_adjustment, 374_500)
        for basic, taxable_income in ((630_000, 3_570_000), (670_000, 3_530_000)):
            self.assertEqual(5_200_000 - 1_000_000 - basic, taxable_income)
            # Invert by enumerating donation amounts, using the published 69.58%.
            valid = [amount for amount in range(2_000, 150_000, 1000)
                     if Decimal(amount - 2_000) * Decimal("0.6958") <= Decimal(after_adjustment) / 5]
            self.assertEqual(max(valid), 109_000)


if __name__ == "__main__":
    unittest.main(verbosity=2)
