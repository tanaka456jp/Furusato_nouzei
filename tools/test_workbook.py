"""Static preservation, input wiring and independent synthetic reference amounts."""
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from openpyxl import load_workbook
from build_workbook import ROOT, HOME, ENGINE, DETAIL, RESIDENT, ADVANCED, INPUT, BATCH, build


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

    def test_local_multi_person_sheet_fail_closed(self):
        self.assertIn(BATCH, self.book.sheetnames)
        sheet = self.book[BATCH]
        self.assertEqual(sheet.sheet_state, "veryHidden")
        self.assertEqual(sheet.max_row, 26)
        self.assertGreaterEqual(sheet.max_column, 50)
        self.assertEqual(sheet["AG6"].value, "配偶者控除額（所得税）")
        self.assertEqual(sheet["AH6"].value, "配偶者控除有（1/2）")
        self.assertEqual(sheet["AK6"].value, "特定扶養人数")
        self.assertEqual(sheet["AN6"].value, "一般扶養人数")
        self.assertEqual(sheet["AW6"].value, "非居住親族人数")
        self.assertEqual(sheet["AX6"].value, "参照源泉票の年分（読取値）")
        self.assertEqual(sheet["C6"].value, "試算対象年")
        self.assertEqual(sheet["A6"].value, "PDF頁")
        self.assertEqual(sheet["E6"].value, "限度額の目安")
        self.assertEqual(sheet["H6"].value, "対象年見込額・控除条件を照合済")
        self.assertEqual(sheet["I6"].value, "源泉票外の追加所得・控除なしを確認")
        self.assertEqual(sheet["AE6"].value, "読取判定")
        self.assertTrue(all(sheet[f"E{i}"].value is None for i in range(7,27)))
        self.assertTrue(all(sheet[f"F{i}"].value is None for i in range(7,27)))
        self.assertEqual(str(sheet.print_area), "'一括試算一覧'!$A$1:$J$26")
        self.assertEqual(sheet.freeze_panes, "D7")
        self.assertEqual(len(sheet.data_validations.dataValidation), 3)
        self.assertEqual([s.title for s in self.book if s.sheet_state == "visible"], [HOME])

    def test_batch_corrected_fields_are_editable_and_explained(self):
        sheet = self.book[BATCH]
        for address in ("C7", "D7", "K7", "L7", "M7", "N7",
                        "O7", "P7", "AG7", "AJ7", "AW7",
                        "H7", "I7", "J7"):
            self.assertFalse(sheet[address].protection.locked, address)
            self.assertEqual(sheet[address].fill.fgColor.rgb[-6:],
                             "FFF6DB", address)
        for address in ("E7", "F7", "G7"):
            self.assertNotEqual(sheet[address].fill.fgColor.rgb[-6:],
                                "FFF6DB", address)
        self.assertIn("自動再試算", sheet["A5"].value)
        self.assertIn("手入力値を優先", sheet["A5"].value)
        self.assertIn("原票年分はAX列", sheet["A5"].value)
        self.assertTrue(sheet["AX7"].protection.locked)
        self.assertNotEqual(sheet["AX7"].fill.fgColor.rgb[-6:], "FFF6DB")

    def test_zero_spouse_income_first_band(self):
        # Only D=0 is special; every positive spouse-income bracket retains
        # its strict lower boundary to prevent counting adjacent bands twice.
        for row in (36, 37):
            for col in ("F", "H"):
                address = f"{col}{row}"
                baseline = self.baseline[ENGINE][address].value
                generated = self.book[ENGINE][address].value
                old_floor = f'"<"&$D{row}'
                revised_floor = f'"<"&IF($D{row}=0,1,$D{row})'
                self.assertEqual(baseline.count(old_floor), 1, address)
                self.assertIn(revised_floor, generated, address)
                self.assertNotIn(old_floor, generated, address)

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
        self.assertEqual(str(self.book[HOME].print_area), "'操作画面'!$A$1:$D$39")
        self.assertEqual(str(self.book[DETAIL].print_area), "'計算根拠'!$A$1:$D$19")
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

    def test_derived_formulas_and_advanced_amounts_fail_closed(self):
        formula = self.book[HOME]["B28"].value
        # Only special tax cases should fail closed. Ordinary pension and
        # business/misc income must not be treated as exclusions.
        self.assertIn("N('例外・分離課税'!B21)>0", formula)
        self.assertIn("'例外・分離課税'!B33", formula)
        # Split taxable income must not be an unconditional rejection.
        # The only N(B24)>0,N(...) guard is for a *combined mortgage credit*.
        self.assertIn("N('例外・分離課税'!B24)>0,N(B34)>0", formula)
        self.assertIn("N('例外・分離課税'!B24)=0,OR(", formula)
        self.assertIn("'例外・分離課税'!B20", formula)
        self.assertIn('"REQUIRES_REVIEW"', formula)
        for cell in ("B7", "B8", "B9", "B10", "B12"):
            self.assertNotIn(f"N('例外・分離課税'!{cell})>0", formula)
        # Housing is normal processing: a positive B33 alone is not a fail gate.
        self.assertNotIn("N(B33)>0", formula)
        self.assertIn("N(B34)>0", formula)
        self.assertIn("ISNUMBER(B38)", formula)
        self.assertIn("住宅ローン", self.book[HOME]["A32"].value)
        self.assertIn("B34-B33", self.book[HOME]["B38"].value)
        self.assertTrue(self.book[HOME]["B38"].protection.locked)

    def test_split_donation_allocation_is_real_tax_difference(self):
        model = self.book["分離課税寄附控除"]
        self.assertEqual(model.sheet_state, "veryHidden")
        self.assertIn("分離課税寄附控除", self.book[RESIDENT]["B26"].value)
        self.assertIn("'例外・分離課税'!B24",self.book[RESIDENT]["B26"].value)
        self.assertIn("ROUNDDOWN(MAX(0,",model["B4"].value)
        self.assertIn("IF(",model["B4"].value)
        self.assertIn("ROUNDDOWN(B3,-3)",model["B5"].value)
        self.assertIn("0.4",model["B8"].value)
        self.assertIn("0.3",model["B9"].value)
        self.assertIn("MAX(0,$B$3-MAX(0,F50-$B$2))",model["H50"].value)
        self.assertIn("($B$6-I50)*1.021",model["J50"].value)
        self.assertIn("MAX(0,F50-$B$2)",model["Q50"].value)
        self.assertIn("'住民税再計算'!B19",model["B10"].value)
        self.assertIn("'住民税再計算'!B22",model["B12"].value)
        self.assertEqual(model["E50"].value,"=200000")
        self.assertEqual(model["B46"].data_type,"f")
        self.assertIn("B43*1000",model["B46"].value)
        self.assertTrue(all(model[f"P{x}"].data_type=="f" for x in range(19,43)))
        extra=self.book[ADVANCED]
        self.assertIn("控除前額",extra["A36"].value)
        self.assertTrue(any("B36" in str(v.sqref) for v in extra.data_validations.dataValidation))

    def test_advanced_form_is_hidden_until_explicitly_requested(self):
        self.assertEqual(self.book[ADVANCED].sheet_state, "veryHidden")
        extra = self.book[ADVANCED]
        self.assertEqual(extra["B4"].value, '=IF(N(B24)>0,"分離課税","通常")')
        self.assertTrue(extra["B4"].protection.locked)
        self.assertFalse(any("B4" in rule for rule in extra.data_validations.dataValidation))
        self.assertIn("公的年金", extra["A5"].value)
        self.assertIn("公的年金", extra["A7"].value)
        self.assertIn("分離課税", extra["A24"].value)
        self.assertIn("ROUNDDOWN(B24*0.05",extra["B27"].value)
        self.assertIn("ROUNDDOWN(B24*0.09",extra["B27"].value)
        self.assertIn('B25="土地建物短期",0.3',extra["B34"].value)
        self.assertIn("'例外・分離課税'!B27",self.book[RESIDENT]["B15"].value)
        self.assertIn("'例外・分離課税'!B24",self.book[RESIDENT]["B25"].value)
        self.assertIn("'例外・分離課税'!B34",self.book[RESIDENT]["B21"].value)
        self.assertEqual(extra["B33"].value,"なし")
        self.assertIn("旧長期損害保険料", extra["A21"].value)
        self.assertNotIn("旧方式", " ".join(str(extra[f"A{i}"].value or "") for i in range(4,33)))
        self.assertIn("所得年内", extra["A3"].value)
        self.assertIn("参照源泉票の年分", extra["A40"].value)
        self.assertTrue(extra["B40"].protection.locked)
        self.assertIsNone(extra["B40"].value)
        self.assertIn("$D$40", str(extra.print_area))
        self.assertIn("ROUNDDOWN", extra["B7"].value)
        self.assertIn("MIN(100000", extra["B29"].value)
        self.assertIn("MAX(0,N(B8)-N(B9))", extra["B28"].value)
        self.assertIn("'住民税再計算'!B21", extra["B22"].value)
        self.assertEqual(extra["B25"].value,"なし")
        self.assertEqual(self.book[INPUT]["B11"].data_type,"f")
        self.assertIn("'例外・分離課税'!B28",self.book[INPUT]["B11"].value)
        self.assertIn("源泉票", extra["A14"].value)
        self.assertNotIn("'例外・分離課税'!B4", self.book[HOME]["B28"].value)
        self.assertIn("'例外・分離課税'!B14", self.book[HOME]["B28"].value)

    def test_auto_income_and_deductions_and_no_one_stop_attestation(self):
        home = self.book[HOME]
        for address in ("B13", "B14", "B17", "B18"):
            self.assertEqual(home[address].data_type, "f")
            self.assertTrue(home[address].protection.locked)
        self.assertIn("'源泉徴収票入力'!B34", home["B13"].value)
        self.assertIn("ROUNDDOWN(B12/4000,0)*4000", home["B13"].value)
        self.assertIn("IF(D4=2025,650000,740000)", home["B13"].value)
        self.assertIn("'例外・分離課税'!B13", home["B13"].value)
        self.assertIn("'ふるさと納税限度額計算'!F24", home["B17"].value)
        self.assertIn("'ふるさと納税限度額計算'!F25", home["B18"].value)
        self.assertEqual(home["D24"].value, "ワンストップ")
        self.assertIsNone(home["D25"].value)
        self.assertNotIn('D25<>"確認済"', home["B28"].value)

    def test_no_customer_values_in_main_inputs(self):
        home = self.book[HOME]
        user_fields = ["B11", "B12", "B15", "B16", "B33", "B34", "B35", "B36"] + [
            f"B{i}" for i in range(19, 26)
        ] + [f"D{i}" for i in range(11, 24)]
        defaults = {"B11": "2026", "B25": "なし", "D22": "該当なし"}
        for cell in user_fields:
            self.assertEqual(home[cell].value, defaults.get(cell), cell)
            self.assertFalse(home[cell].protection.locked, cell)
            self.assertTrue(any(cell in rule for rule in home.data_validations.dataValidation), cell)
        for cell, source in (("B13","B15"),("B14","B14"),("B17","B16"),("B18","B17")):
            self.assertIn(f"ISNUMBER('例外・分離課税'!{source})", home[cell].value)

    def test_no_manual_unsupported_toggle_and_auto_status(self):
        home = self.book[HOME]
        self.assertEqual(home["A26"].value, "計算可否（入力から自動判定）")
        self.assertEqual(home["B26"].data_type, "f")
        self.assertTrue(home["B26"].protection.locked)
        self.assertIn('IF(B28="正常","計算可能","追加確認")',home["B26"].value)
        self.assertNotIn('B26="該当あり"',home["B28"].value)
        self.assertNotIn('B26<>"該当なし"',home["B28"].value)
        for rule in home.data_validations.dataValidation:
            self.assertNotIn("B26", str(rule.sqref))
        source=(ROOT/"vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        self.assertNotIn('Range("B26").Value2 = ', source)
        self.assertNotIn('B19:B26',source)
        self.assertNotIn('Range("B4").Value2 = "通常"',source)

    def test_generated_formulas_have_valid_excel_parentheses(self):
        # Excel rejects a workbook when an overlong/malformed nested status
        # formula is present. This catches accidental extra closings BEFORE COM.
        for addr in ("B13", "B14", "B17", "B18", "B28"):
            formula = self.book[HOME][addr].value
            self.assertIsInstance(formula, str, addr)
            self.assertLess(len(formula), 8192, addr)
            depth, quoted = 0, False
            for char in formula:
                if char == '"':
                    quoted = not quoted
                elif not quoted and char == '(':
                    depth += 1
                elif not quoted and char == ')':
                    depth -= 1
                    self.assertGreaterEqual(depth, 0, f"{addr}: excess closing bracket")
            self.assertEqual(depth, 0, f"{addr}: unclosed bracket")
            self.assertFalse(quoted, f"{addr}: unmatched Excel string quote")

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
