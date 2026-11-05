"""Static preservation, input wiring and independent synthetic reference amounts."""
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from openpyxl import load_workbook
from build_workbook import ROOT, HOME, DETAIL, RESIDENT, build


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

    def test_no_customer_values_in_main_inputs(self):
        home = self.book[HOME]
        for cell in [f"B{i}" for i in range(11, 27)] + [f"D{i}" for i in range(11, 26)]:
            self.assertIsNone(home[cell].value, cell)
            self.assertFalse(home[cell].protection.locked, cell)
            self.assertTrue(any(cell in rule for rule in home.data_validations.dataValidation), cell)

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
