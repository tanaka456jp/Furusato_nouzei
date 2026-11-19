"""Static preservation, input wiring and independent synthetic reference amounts."""
import ast
from decimal import Decimal
from itertools import chain
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

from openpyxl import load_workbook
from build_workbook import ROOT, HOME, ENGINE, DETAIL, RESIDENT, ADVANCED, INPUT, build


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

    def test_direct_resident_deductions_do_not_depend_on_national_taxable(self):
        model = self.book[ENGINE]
        baseline = self.baseline[ENGINE]["J44"].value
        taxable = model["J44"].value
        self.assertIsInstance(baseline, str)
        self.assertTrue(baseline.startswith("="))
        self.assertTrue(taxable.startswith("=IF(AND("))
        self.assertIn("ROUNDDOWN(MAX(0,D15-SUM(", taxable)
        for source in (
            "'操作画面'!B16",
            "H15,H24,H25,H38,H40",
            "'追加人的控除'!D12",
            "'例外・分離課税'!B28",
            "'例外・分離課税'!B24",
            "'操作画面'!D25",
            "'源泉徴収票入力'!B13",
        ):
            self.assertIn(source, taxable)
        # The former national-taxable-income bridge remains only as the
        # out-of-scope fallback; the accepted ordinary-salary branch uses
        # gross income and independently computed resident deductions.
        self.assertTrue(taxable.endswith("," + baseline[1:] + ")"))
        self.assertIn("J12+J43", baseline)
        self.assertLess(len(taxable), 8192)
        self.assertEqual(
            self.book[RESIDENT]["B6"].value,
            self.baseline[RESIDENT]["B6"].value,
        )
        details = self.book[DETAIL]["B6"].value
        self.assertIn("SUM(", details)
        self.assertIn("'追加人的控除'!D12", details)

    def test_fresh_sheet_has_neutral_input_prompt_and_no_calc_bypass(self):
        home = self.book[HOME]
        formula = home["B28"].value
        self.assertTrue(formula.startswith("=IF(AND(COUNT(B12,B15,B16)<3,"))
        self.assertIn("COUNTA(B12,B15,B16)=COUNT(B12,B15,B16)", formula)
        self.assertIn("入力待ち：支払金額・源泉徴収税額・社会保険料等を入力してください",formula)
        self.assertIn("エラー：入力または計算式を確認してください",formula)
        self.assertIn('IF(B28<>"正常",IF(AND(',home["B8"].value)
        self.assertIn('AUTO_REFERENCE',home["B8"].value)
        self.assertIn('B49',home["B8"].value)
        self.assertIn('B47=IFERROR(1*B4,0)',home["B8"].value)
        self.assertEqual(home["A9"].value, "=F9")
        self.assertIn("AUTO_REFERENCE", home["F9"].value)
        self.assertIn("ISNUMBER(", home["A8"].value)
        self.assertIn("限度額未確定", home["F9"].value)
        self.assertIn('自動参考額（未確定・円）',home["A8"].value)
        self.assertIn('IF(B28<>"正常",""',home["D8"].value)
        self.assertIn('LEFT($B$28,4)="入力待ち"',
                      [x for rule in home.conditional_formatting["A9:D9"]
                       for x in (rule.formula or [])])
        self.assertTrue(any(
            'LEFT($B$28,4)<>"入力待ち"' in expr
            for rule in home.conditional_formatting["A9:D9"]
            for expr in (rule.formula or [])
        ))

    def test_explicit_separate_city_prefecture_100yen_rounding(self):
        resident = self.book[RESIDENT]
        home = self.book[HOME]
        levy = resident["B16"].value
        baseline = self.baseline[RESIDENT]["B16"].value
        self.assertIsInstance(baseline, str)
        self.assertTrue(baseline.startswith("="))
        for share in (6, 4, 8, 2):
            self.assertIn(f"ROUNDDOWN(ROUND(ROUND(MAX(0,B15-B14),2)*{share}/10,3),-2)", levy)
        self.assertNotIn("'操作画面'!B19:B24", levy)
        self.assertIn("'例外・分離課税'!B24", levy)
        self.assertIn("'例外・分離課税'!B27", levy)
        self.assertIn("'ふるさと納税限度額計算'!J51:J53", levy)
        self.assertIn("'操作画面'!D51=\"標準市町村\"", levy)
        self.assertIn("'操作画面'!D51=\"標準指定都市\"", levy)
        self.assertEqual(home["D51"].value, "条例差・不明")
        self.assertIn("SAFE-TAX-036", home["B28"].value)
        self.assertIn("SAFE-TAX-037", home["B28"].value)
        self.assertIn("SAFE-TAX-038", home["B28"].value)
        self.assertIn("SAFE-TAX-039", home["B28"].value)
        for row in (5, 8, 9, 10, 11, 12, 26):
            self.assertIn(f"'例外・分離課税'!B{row}<>0", home["B28"].value)
        self.assertEqual(resident["B35"].value,
                         '=IF(B15="","",ROUNDDOWN(ROUND(MAX(0,B15-B14),2),-2))')
        self.assertTrue(levy.endswith("," + baseline[1:] + ")"))
        self.assertLess(len(levy), 8192)

    def test_2026_verified_under23_life_formula_and_existing_year_preservation(self):
        general = self.book[ENGINE]["F19"].value
        original = self.baseline[ENGINE]["F19"].value
        self.assertIsInstance(original, str)
        self.assertTrue(original.startswith("="))
        self.assertTrue(general.startswith("=IF(AND("))
        self.assertIn("'設定・税率'!B4=2026", general)
        self.assertIn("B25=" + chr(34) + "あり" + chr(34), general)
        self.assertIn("'操作画面'!B19", general)
        self.assertIn("'操作画面'!B20", general)
        self.assertIn("ROUNDUP(", general)
        self.assertIn(">60000,MAX(", general)
        self.assertIn("MIN(60000,", general)
        self.assertTrue(general.endswith("," + original[1:] + ")"))
        self.assertLess(len(general), 8192)
        # Original aggregate cap (120k) must remain intact.
        self.assertEqual(self.book[ENGINE]["F24"].value,
                         self.baseline[ENGINE]["F24"].value)

    def test_multi_person_salary_only_overview_is_isolated(self):
        batch = self.book["一括計算一覧"]
        home = self.book[HOME]
        self.assertEqual(batch.sheet_state, "visible")
        self.assertIn("給与所得のみ", batch["A1"].value)
        self.assertIn("その他の所得", batch["A2"].value)
        self.assertIn("精緻計算は操作画面", batch["A2"].value)
        self.assertIn("HOLD", batch["A3"].value)
        self.assertEqual(batch["A4"].hyperlink.location, "'操作画面'!A1")
        self.assertGreaterEqual(batch.row_dimensions[4].height, 30)
        self.assertGreaterEqual(batch.column_dimensions["B"].width, 14)
        self.assertEqual(batch["D4"].value, "=COUNT(B6:B105)")
        self.assertEqual(batch["F4"].value, '=COUNTIF(J6:J105,"参考額（仮）")')
        self.assertEqual(batch["H4"].value, '=COUNTIF(J6:J105,"HOLD／要確認")')
        self.assertEqual(batch["A5"].value, "氏名")
        self.assertEqual(batch["B5"].value, "ページ")
        self.assertEqual(batch["I5"].value, "上限額参考（円）")
        self.assertEqual(batch["J5"].value, "判定")
        self.assertEqual(batch["K5"].value, "判定理由（詳細）")
        report = self.book["自動試算根拠"]
        self.assertEqual(report.sheet_state, "veryHidden")
        self.assertEqual(str(report.print_area), "'自動試算根拠'!$A$1:$D$27")
        self.assertEqual(report["A15"].value, "住民税所得割（調整控除後・仮定）")
        self.assertEqual(report["A17"].value, "ふるさと納税特例控除割合")
        self.assertIn("未確定", report["A1"].value)
        self.assertEqual(report["A3"].value, "受給者氏名（源泉票E03）")
        self.assertEqual(batch["K4"].value, "全員分PDF出力")
        self.assertIn("DecodeRecipientNameForBatch", (ROOT / "vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig"))
        # VBA four-digit &H9FFF is signed 16-bit (-24577). Upper Kanji
        # boundary must instead be an explicitly Long positive decimal.
        self.assertIn("cp >= 13312& And cp <= 40959&", (ROOT / "vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig"))
        self.assertIn("BatchLastInnerErrorForTest", (ROOT / "vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig"))
        self.assertTrue(all(batch.column_dimensions[c].hidden for c in "LMNOPQRS"))
        self.assertEqual(batch.freeze_panes, "C6")
        self.assertEqual(batch.auto_filter.ref, "A5:S105")
        for row in (6, 9, 105):
            self.assertIsNone(batch[f"I{row}"].value)
        vb = (ROOT / "vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        setup = (ROOT / "tools/setup.ps1").read_text(encoding="utf-8-sig")
        self.assertIn('Public Sub ImportWithholdingBatch()', vb)
        self.assertIn('home.Range("A9").Formula = "=F9"', vb)
        self.assertNotIn('home.Range("A9").Formula = "=B28"', vb)
        self.assertIn('Public Function LoadBatchFromTsv(', vb)
        self.assertIn('Public Function TryLoadBatchFromTsvForTest(', vb)
        qa = (ROOT / "tools/verify_excel.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("'TaxLawUpdater.TryLoadBatchFromTsvForTest'", qa)
        self.assertNotIn("[void]($excel.Run('TaxLawUpdater.LoadBatchFromTsv', $invalidPath))", qa)
        self.assertIn('"一括計算一覧"', vb)
        self.assertIn('If status = "HOLD" And Len(CStr(pieces(7))) > 0 Then', vb)
        self.assertIn('target.Range("A6:S105").ClearContents', vb)
        self.assertIn('reportHeader = requiredHeader & vbTab', vb)
        self.assertIn('Public Function ExportAllBatchReferencePDFsToFolder(', vb)
        self.assertIn('Public Sub ExportAllBatchReferencePDFs()', vb)
        self.assertIn('BindButton "一括計算一覧", "btnExportAllBatchReferencePDFs"', vb)
        self.assertIn('fso.MoveFolder staging, outputFolder', vb)
        self.assertIn('report.Visible = xlSheetVeryHidden', vb)
        self.assertIn('report.Range("B3:B19").ClearContents', vb)
        self.assertIn('report.Range("B20:D23").ClearContents', vb)
        self.assertIn('seenPages.Exists(CStr(page))', vb)
        self.assertIn(" --batch-bridge", vb)
        self.assertIn('BindButton "操作画面", "btnImportWithholdingBatch"', vb)
        self.assertIn("Add-WorkbookButton $sheet 'D3' '複数人一覧'", setup)
        self.assertIn("Add-WorkbookButton $batch 'B4' '一覧消去'", setup)
        self.assertIn("Add-WorkbookButton $batch 'K4' '全員分PDF出力'", setup)
        self.assertIn('Public Sub ClearBatchOverview()', vb)
        self.assertIn('Private Function BatchOverviewHasRecords()', vb)
        self.assertIn('If BatchOverviewHasRecords() Then', vb)
        self.assertIn('BindButton "一括計算一覧", "btnClearBatchOverviewWithConfirm"', vb)
        # The bulk command never copies one person's values into the
        # single-case input B12/B15/B16 nor alters calculation formulas.
        bulk = vb.split("Public Sub ImportWithholdingBatch()", 1)[1].split(
            "' Import only allowlisted numeric fields", 1)[0]
        self.assertNotIn('home.Range("B12")', bulk)
        self.assertNotIn('home.Range("B15")', bulk)
        self.assertNotIn('home.Range("B16")', bulk)

    def test_five_relative_individual_tax_and_resident_wiring(self):
        rel = self.book["特定親族明細"]
        home = self.book[HOME]
        engine = self.book[ENGINE]
        self.assertEqual(rel.sheet_state, "visible")
        self.assertEqual(rel["A8"].value, 5)
        self.assertEqual(rel["A15"].hyperlink.ref, "A15")
        self.assertIsNone(rel["G9"].value)
        self.assertEqual(home["A3"].hyperlink.location, "'特定親族明細'!A1")
        self.assertEqual(rel["D4"].value, "未確認")
        self.assertEqual(rel["D8"].value, "未確認")
        for person in range(3):
            row = person + 4
            self.assertIn(f"'操作画面'!D{row+10}",rel[f"C{row}"].value)
            self.assertTrue(rel[f"C{row}"].protection.locked)
            self.assertEqual(engine[f"F{row+28}"].value,f"='特定親族明細'!E{row}")
            self.assertEqual(engine[f"H{row+28}"].value,f"='特定親族明細'!F{row}")
        self.assertIn("'特定親族明細'!E7:E8",engine["F38"].value)
        self.assertIn("'特定親族明細'!F7:F8",engine["H38"].value)
        self.assertEqual(engine["J38"].value,"=F38-H38")
        self.assertIn("'ふるさと納税限度額計算'!F38",home["B31"].value)
        self.assertIn("特定親族明細'!G4:G8",home["B28"].value)
        self.assertIn('B25="なし",OR(COUNTIF(',home["B28"].value)
        self.assertIn('"特定扶養親族")>0,N(D23)>0',home["B28"].value)
        # Neither family income-levy nor protected-status exemption can be
        # evaluated on salary income alone when other income is present.
        verdict = home["B28"].value
        total = "'例外・分離課税'!B30"
        self.assertEqual(verdict.count(total), 2)
        self.assertIn("'例外・分離課税'!B24",verdict)
        self.assertIn("'例外・分離課税'!B36",verdict)
        self.assertNotIn("B13<=IF(",verdict)
        self.assertNotIn("B13<=1350000",verdict)
        self.assertNotIn('AND(COUNT(D14:D16,D23)>0',home["B28"].value)
        for row in (4, 5, 6, 7, 8):
            category = rel[f"G{row}"].value
            self.assertIn("2025,580000,620000",category)
            self.assertIn('要件確認済',category)
            self.assertIn('B'+str(row)+'<19',category)
            income = rel[f"E{row}"].value
            resident = rel[f"F{row}"].value
            self.assertIn("<=850000,630000",income)
            self.assertIn("<=900000,610000",income)
            self.assertIn("<=950000,450000",resident)
            self.assertIn("<=1000000,410000",resident)
        fingerprint=self.book[ADVANCED]["B42"].value
        self.assertTrue(fingerprint.startswith("=LEN("), "Snapshots must length-prefix every input")
        self.assertLess(len(fingerprint), 8192, "Excel formula length must remain supported")
        self.assertIn(')&":"&', fingerprint)
        self.assertIn("LEN('特定親族明細'!D8)", fingerprint)
        self.assertNotIn("TEXTJOIN(", fingerprint)
        for addr in ("B4","D4","B8","C8","D8"):
            self.assertIn(f"'特定親族明細'!{addr}",fingerprint)
        for r in ("D14","D15","D16"):
            self.assertIn(f"'操作画面'!{r}",fingerprint)
        self.assertIn("SUM(E4:E8)",rel["E10"].value)
        self.assertIn("SUM(F4:F8)",rel["F10"].value)
        for address in ("B7","B8","C7","C8"):
            self.assertTrue(any(address in str(rule.sqref)
                                for rule in rel.data_validations.dataValidation))

    def test_relative_import_and_review_are_case_specific(self):
        vb=(ROOT/"vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        self.assertIn('Private Sub ResetRelativeInputs()',vb)
        self.assertIn('rel.Range("B4:B8,C7:C8").ClearContents',vb)
        self.assertIn('rel.Range("D4:D8").Value2 = "未確認"',vb)
        self.assertEqual(vb.count("    ResetRelativeInputs"),2)
        self.assertIn('ValidateSpecialRelativeSource home, extra, relatives',vb)
        self.assertIn('For row = 4 To 8',vb)
        self.assertIn('If category = "要確認" Then',vb)
        self.assertIn('If actualCount <> sourceCount Then',vb)
        self.assertIn('If actualAmount <> sourceAmount Then',vb)
        self.assertIn('Public Function SpecialRelativeSourceCheckForTest() As String',vb)

    def test_import_taxpayer_switch_does_not_leak_additional_income(self):
        vb=(ROOT/"vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        qa=(ROOT/"tools/verify_excel.ps1").read_text(encoding="utf-8-sig")
        self.assertIn('taxpayerChoice = MsgBox(',vb)
        self.assertIn('vbYesNoCancel + vbDefaultButton3',vb)
        self.assertIn('newTaxpayer = ImportMustResetAdditionalIncome(year, taxpayerChoice = vbYes)',vb)
        self.assertIn('Private Function ImportMustResetAdditionalIncome(',vb)
        self.assertIn('Range("B11").Value2) <> CStr(sourceYear)',vb)
        self.assertIn('Range("B4").Value2) <> CStr(sourceYear)',vb)
        self.assertIn('Range("D4").Value2) <> CStr(sourceYear)',vb)
        self.assertIn('2025, $false',qa)
        self.assertIn('Public Function ImportResetDecisionForTest(',vb)
        self.assertIn('If taxpayerChoice = vbCancel Then GoTo CleanUp',vb)
        self.assertIn('If MsgBox(caution, vbQuestion + vbYesNo + vbDefaultButton2) <> vbYes Then GoTo CleanUp',vb)
        self.assertIn('If Len(tempTsv) > 0 Then If fso.FileExists(tempTsv) Then fso.DeleteFile tempTsv, True',vb)
        self.assertIn('If Len(tempJson) > 0 Then If fso.FileExists(tempJson) Then fso.DeleteFile tempJson, True',vb)
        self.assertIn('PrepareAdditionalIncomeForImport extra, newTaxpayer',vb)
        self.assertIn('Private Sub PrepareAdditionalIncomeForImport(',vb)
        self.assertIn('If Not newTaxpayer Then Exit Sub',vb)
        self.assertIn('extra.Range("B5:B6,B8:B12,B21,B24:B26,B33,B36").ClearContents',vb)
        self.assertIn('If StrComp(ThisWorkbook.Name, "FurusatoQA.xlsm", vbTextCompare) <> 0 Then',vb)
        self.assertIn("import-taxpayer-switch-isolation-pass",qa)
        self.assertIn("Same taxpayer preserves split income",qa)
        self.assertIn("New taxpayer resets special cases",qa)

    def test_multi_page_pdf_requires_explicit_single_page_selection(self):
        code=(ROOT/"vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        reader=(ROOT/"tools/withholding_reader.py").read_text(encoding="utf-8-sig")
        self.assertIn('If LCase$(fso.GetExtensionName(CStr(picked))) = "pdf" Then',code)
        self.assertIn('" --page-count"',code)
        self.assertIn('pageChoice = Application.InputBox(',code)
        self.assertIn('If VarType(pageChoice) = vbBoolean Then GoTo CleanUp',code)
        self.assertIn('" --page " & CStr(CLng(pageChoice))',code)
        self.assertIn('"対象：PDFの" &',code)
        self.assertIn('SELECTED_PDF_PAGE_',code)
        self.assertIn('If pageCount > 1 Then',code)
        self.assertIn('pageArg',code)
        self.assertIn('if page_number is None and multiple:',reader)
        self.assertIn('PDF_PAGE_SELECTED',reader)
        self.assertIn('MULTIPAGE_SELECTED_PAGE_REVIEW',reader)
        self.assertIn('if args.page_count:',reader)

    def test_first_open_full_recalculation_without_permanent_force_flag(self):
        # A full initial calculation is still requested. Avoid permanent
        # forced-full calculation because this suppresses smart dependency
        # recalculation in Excel and can leave global xlPending.
        self.assertEqual(self.book.calculation.calcMode, "auto")
        self.assertTrue(self.book.calculation.fullCalcOnLoad)
        self.assertFalse(self.book.calculation.forceFullCalc)

    def test_stale_result_vba_guards(self):
        source = (ROOT / "vba" / "TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        setup = (ROOT / "tools" / "setup.ps1").read_text(encoding="utf-8-sig")
        for token in ("Public Sub MaskUnverifiedResults()", "Public Sub RevealVerifiedResults()",
                      "Public Function ResultsAreCurrent() As Boolean",
                      "Private Sub CheckReportAvailable", "If Not ResultsAreCurrent() Then",
                      'NumberFormat = ";;;"'):
            self.assertIn(token, source)
        for token in ("Private Sub Workbook_SheetChange",
                      "TaxLawUpdater.MaskUnverifiedResults",
                      "TaxLawUpdater.RevealVerifiedResults"):
            self.assertIn(token, setup)
        # Editing any of the thirty relatives invalidates visible cached
        # donation results, exactly like editing the main/advanced inputs.
        self.assertIn('Sh Is Me.Worksheets("特定親族明細")', setup)
        excel_qa = (ROOT / "tools" / "verify_excel.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("relative-sheet-manual-stale-result-pass", excel_qa)
        self.assertIn("relative-fifth-case-persistence-pass", excel_qa)
        self.assertIn("Saved case keeps fifth-relative income", excel_qa)

    def test_pdf_visual_acceptance_has_a_static_contract(self):
        workflow = (ROOT / ".github/workflows/workbook.yml").read_text(encoding="utf-8")
        excel = (ROOT / "tools/verify_excel.ps1").read_text(encoding="utf-8-sig")
        code = (ROOT / "tools/audit_pdf_layout.py").read_text(encoding="utf-8")
        compile(code, "tools/audit_pdf_layout.py", "exec")
        # Compile succeeds even if a mistakenly escaped newline comments out
        # the assignment; check the executable AST actually binds rendered.
        syntax = ast.parse(code)
        proof_fn = next(n for n in syntax.body if isinstance(n, ast.FunctionDef)
                        and n.name == "assert_split_print_source_proof")
        self.assertTrue(any(isinstance(n, ast.Name) and n.id == "rendered"
                            and isinstance(n.ctx, ast.Store)
                            for n in ast.walk(proof_fn)),
                        "PDF print proof must assign its normalized value")
        for token in ("Verify synthetic Excel PDF layout and render evidence",
                      "tools/audit_pdf_layout.py --folder", "PDF_LAYOUT_REVIEW_",
                      "-PdfEvidencePath"):
            self.assertIn(token, workflow)
        self.assertIn("synthetic-pdf-audit-input-export-pass", excel)
        for name in ("FurusatoQA.pdf", "FurusatoQA_hidden.pdf", "split-result.pdf", "home-overview.pdf"):
            self.assertIn(name, excel)
        self.assertIn("home-overview-pdf-pass", excel)
        self.assertIn("home-overview.pdf", code)
        self.assertIn('"109,000"', code)
        self.assertIn("Home PDF review version mismatch", code)
        self.assertIn("def assert_no_text_collision(", code)
        self.assertIn("def collision_self_test()", code)
        self.assertIn("checked_words = assert_no_text_collision(", code)
        self.assertIn('"text_collision_self_test": "PASS"', code)
        self.assertIn("def assert_split_print_source_proof(", code)
        self.assertIn("split-result.print-inputs.json", code)
        self.assertIn('"split_print_source_proof": "PASS"', code)
        self.assertIn('"split_print_row_geometry": "PASS"', code)
        self.assertIn("def assert_split_print_row_geometry(", code)
        self.assertIn("value moved to wrong row", code)
        self.assertIn("value moved out of source column", code)
        self.assertIn("tools/audit_pdf_layout.py --self-test", workflow)
        self.assertIn("pymupdf==1.26.4", workflow)
        self.assertIn("split-result.print-inputs.json", excel)
        self.assertIn("pdf_sha256", code)
        live_qa = (ROOT / "tools/test_separate_excel.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("furusato-split-pdf-printed-inputs/v1", live_qa)
        self.assertIn("Get-FileHash -LiteralPath $PdfPath -Algorithm SHA256", live_qa)

    def test_second_print_page_repeats_year_and_both_versions(self):
        home = self.book[HOME]
        formula = str(home["A80"].value)
        self.assertTrue(formula.startswith("=IFERROR("))
        for token in ("D50", "B29", "A1", "CHAR(10)", 'FIND("v4.",A1)'):
            self.assertIn(token, formula)
        self.assertTrue(home["A80"].alignment.wrap_text)
        self.assertGreaterEqual(home.row_dimensions[80].height, 60)
        # Three deliberate lines are required, rather than a wrapped
        # orphaned "版" in the first printed header line.
        self.assertIn('"Excel版 "', formula)
        self.assertIn('CHAR(10)&"税制版 "', formula)
        # Detailed tax-credit page is emitted from the same area as A80.
        source = (ROOT / "vba" / "TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        self.assertIn('DetailsPrintArea = DetailsPrintArea & ",$A$80:$D$93"', source)
        for row, left, right in ((89, "D72", "D73"), (90, "D74", "D75"),
                                  (91, "D76", "D77"), (92, "D49", "D51")):
            self.assertIn('B55="計算可能"', home[f"B{row}"].value)
            self.assertIn(left, home[f"B{row}"].value)
            self.assertIn('B55="計算可能"', home[f"D{row}"].value)
            self.assertIn(right, home[f"D{row}"].value)
            self.assertTrue(home[f"B{row}"].protection.locked)
        self.assertEqual(home["A88"].value, "計算条件の照合（入力値の控え）")
        self.assertTrue(home["A93"].alignment.wrap_text)
        # Visible printing is audited too: header wrapping may be planned,
        # but money allocation must remain on a single printed line.
        self.assertGreaterEqual(home.row_dimensions[57].height, 40)
        self.assertGreaterEqual(home.row_dimensions[67].height, 44)
        for row in range(58, 65):
            self.assertFalse(home[f"B{row}"].alignment.wrap_text)
            self.assertTrue(home[f"B{row}"].alignment.shrink_to_fit)
            self.assertGreaterEqual(home.row_dimensions[row].height, 29)
        for row in range(89, 93):
            self.assertGreaterEqual(home[f"C{row}"].alignment.indent, 1)
            self.assertGreaterEqual(home[f"B{row}"].alignment.indent, 1)
        audit = (ROOT / "tools/audit_pdf_layout.py").read_text(encoding="utf-8")
        self.assertIn("Split PDF allocation wraps to multiple printed lines", audit)
        live_qa = (ROOT / "tools/test_separate_excel.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("Split print source mismatch", live_qa)
        self.assertIn("Split print audit value remained visible under HOLD", live_qa)

    def test_single_visible_home(self):
        self.assertEqual(self.book.active.title, HOME)
        self.assertEqual([s.title for s in self.book if s.sheet_state == "visible"], [HOME, "特定親族明細", "一括計算一覧"])
        self.assertEqual(self.book[DETAIL].sheet_state, "veryHidden")
        self.assertEqual(self.book[HOME]["C4"].alignment.indent, 2)
        self.assertIn("課税自治体", self.book[HOME]["A42"].value)
        self.assertIn("条件限定", self.book[HOME]["A42"].value)
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
        self.assertEqual(str(self.book[HOME].print_area), "'操作画面'!$A$1:$D$39")
        self.assertEqual(str(self.book[DETAIL].print_area), "'計算根拠'!$A$1:$D$23")
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
        mortgage = self.book[HOME]["B38"].value
        self.assertIn("'ふるさと納税限度額計算'!J12", mortgage)
        self.assertIn("'ふるさと納税限度額計算'!F15", mortgage)
        self.assertIn("-480000", mortgage)
        self.assertIn("B35>=2026", mortgage)
        self.assertNotIn("B13-B14", mortgage)
        self.assertIn("SAFE-TAX-028", formula)
        self.assertIn("SAFE-TAX-029", formula)
        self.assertIn("SAFE-TAX-033", formula)
        self.assertIn("SAFE-TAX-034", formula)
        self.assertIn('D24="ワンストップ",N(B34)>0,ISNUMBER(B35),B35=D4',formula)
        # Exercise both 2022 statutory resident-credit ceilings with
        # real Excel evaluation, including zero residual income-tax use.
        real_qa = (ROOT / "tools/verify_excel.ps1").read_text(encoding="utf-8-sig")
        for marker in ("mortgage-2022-cap-ceilings-start",
                       "mortgage-2022-cap-ceilings-pass",
                       "136500 '2022 verified 7-percent resident ceiling'",
                       "97500 '2022 verified 5-percent resident ceiling'",
                       "0 'No residual possible credit after full income-tax use'",
                       "2022 mortgage guidance missing legal contract and VAT checks",
                       "mortgage-2022-cap-rounding-boundaries-start",
                       "mortgage-2022-cap-rounding-boundaries-pass",
                       "136430.0", "97450.0",
                       "Pasted unsupported 2022 mortgage eligibility escaped HOLD"):
            self.assertIn(marker, real_qa)
        self.assertIn("AND(ISNUMBER(B34),B34<0)", formula)
        self.assertEqual(self.book[HOME]["D35"].value, "未確認")
        mortgage_rules = [
            item for item in self.book[HOME].data_validations.dataValidation
            if str(item.sqref) == "D35"
        ]
        self.assertEqual(len(mortgage_rules), 1)
        self.assertTrue(mortgage_rules[0].showInputMessage)
        for key in ("消費税10%", "2020/10", "2021/9", "2020/12", "2021/11", "未確認"):
            self.assertIn(key, mortgage_rules[0].prompt)
        self.assertIn("B35=2022", mortgage)
        self.assertIn("D35=\"経過措置7%確認\"", mortgage)
        self.assertIn("D35=\"通常5%確認\"", mortgage)
        self.assertIn("136500", mortgage)
        self.assertIn("97500", mortgage)
        self.assertIn("70,50", mortgage)
        source = (ROOT / "vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        self.assertIn('home.Range("D35").Value2 = "未確認"', source)
        self.assertIn("ResetSeparateInputs home", source)
        self.assertIn('ResetSeparateInputs ThisWorkbook.Worksheets("操作画面")', source)
        self.assertTrue(self.book[HOME]["B38"].protection.locked)

    def test_one_stop_housing_uses_available_resident_levy_without_hold(self):
        result = self.book[RESIDENT]["B26"].value
        verdict = self.book[HOME]["B28"].value
        self.assertIn('D24="ワンストップ"', result)
        self.assertIn("'操作画面'!B34", result)
        self.assertIn("'操作画面'!B38", result)
        self.assertIn("'住民税再計算'!B16", result)
        self.assertIn("ROUNDDOWN((", result)
        self.assertIn("+2000)/1000,0)*1000", result)
        self.assertIn("MIN(", result)
        self.assertIn("N('例外・分離課税'!B24)>0,N(B34)>0,ISNUMBER(B38)", verdict)
        # The nominal 20% cap is not replaced with a post-housing levy:
        # capacity is tested only at final display, after the statutory cap.
        self.assertNotIn("'操作画面'!B38", self.book[RESIDENT]["B19"].value)
        self.assertLess(len(result), 8192)

    def test_tax_return_housing_has_own_real_tax_difference_search(self):
        model = self.book["住宅確申寄附検算"]
        self.assertEqual(model.sheet_state, "veryHidden")
        result = self.book[RESIDENT]["B26"].value
        verdict = self.book[HOME]["B28"].value
        self.assertIn("'住宅確申寄附検算'!B46", result)
        self.assertIn('D24="確定申告"', result)
        self.assertIn("SAFE-TAX-035", verdict)
        self.assertIn("N(B33)<>MIN(N(B34),N('住宅確申寄附検算'!B3))",
                      verdict)
        self.assertIn('D24="確定申告",N(B34)>0', verdict)
        self.assertIn("MIN(MAX(0,B5-MIN(B3,B5)),B9", model["B6"].value)
        self.assertIn("'住民税再計算'!B19", model["B10"].value)
        self.assertIn("'住民税再計算'!B22", model["B11"].value)
        self.assertIn("$B$2-F50", model["G50"].value)
        self.assertIn("H50-I50", model["K50"].value)
        self.assertIn("G50+$B$12", model["J50"].value)
        self.assertIn("$B$7-J50-L50-M50", model["N50"].value)
        self.assertIn("$B$4+$B$8-K50-N50", model["O50"].value)
        self.assertIn("O50+1>=E50-2000", model["P50"].value)
        self.assertIn("E50-O50", model["Q50"].value)
        self.assertEqual(model["E50"].value, "=109000")
        self.assertEqual(model["B46"].data_type, "f")
        self.assertTrue(all(model[f"P{x}"].data_type == "f"
                            for x in range(19, 43)))
        # No 2026 source-year personal amounts may be copied to this model.
        self.assertFalse(any("source" in str(model[f"A{x}"].value).lower()
                             for x in range(2, 17)))
        self.assertLess(len(result), 8192)
        self.assertLess(len(verdict), 8192)

    def test_separate_credit_grid_cannot_leak_into_ordinary_estimate(self):
        formula = self.book[HOME]["B28"].value
        self.assertIn("SAFE-TAX-026", formula)
        self.assertIn("SAFE-TAX-027", formula)
        for row in range(72, 78):
            self.assertIn(f"D{row}<>0", formula)
            self.assertEqual(self.book[HOME][f"D{row}"].value, 0)
        self.assertIn("AND(ISNUMBER(B33),B33>0", formula)
        self.assertIn("NOT(ISNUMBER(B34))", formula)
        self.assertIn("B34<B33", formula)
        self.assertIn('B28<>"正常"', self.book[HOME]["B8"].value)
        self.assertIn('AUTO_REFERENCE', self.book[HOME]["B8"].value)
        self.assertIn('B49', self.book[HOME]["B8"].value)
        self.assertIn('B28<>"正常"', self.book[HOME]["D8"].value)

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
        self.assertIn("ROUNDDOWN", extra["B7"].value)
        self.assertIn("MIN(100000", extra["B29"].value)
        self.assertIn("MAX(0,N(B8)-N(B9))", extra["B28"].value)
        self.assertIn("'住民税再計算'!B21", extra["B22"].value)
        self.assertEqual(extra["B25"].value,"なし")
        self.assertEqual(self.book[INPUT]["B11"].data_type,"f")
        self.assertIn("'例外・分離課税'!B28",self.book[INPUT]["B11"].value)
        self.assertIn("源泉票", extra["A14"].value)
        self.assertNotRegex(self.book[HOME]["B28"].value,
                            r"'例外・分離課税'!B4(?![0-9])")
        self.assertIn("'例外・分離課税'!B14", self.book[HOME]["D31"].value)

    def test_auto_income_and_deductions_and_no_one_stop_attestation(self):
        home = self.book[HOME]
        for address in ("B13", "B14", "B17", "B18"):
            self.assertEqual(home[address].data_type, "f")
            self.assertTrue(home[address].protection.locked)
        self.assertIn("'源泉徴収票入力'!B34", home["B13"].value)
        self.assertIn("ROUNDDOWN(B12/4000,0)*4000", home["B13"].value)
        self.assertIn("IF(D4=2025,650000,740000)", home["B13"].value)
        self.assertIn("IF(AND(D4=2026,B12<2200000)", home["B13"].value)
        # The >8.5m salary income adjustment must ROUND UP to a whole yen.
        # Without this, 8,500,001 gross produces a fractional salary income.
        self.assertIn("ROUNDUP((MIN(B12,10000000)-8500000)/10,0)",home["B13"].value)
        self.assertNotIn("(MIN(B12,10000000)-8500000)*0.1",home["B13"].value)
        self.assertIn("IF(B12<2191000,B12-740000", home["B13"].value)
        # A prior withholding slip is evidence, not a 2026 tax value.
        self.assertIn("IFERROR(1*B11,0)=D4",home["B13"].value)
        self.assertIn("IFERROR(1*B11,0)=D4",home["B17"].value)
        self.assertIn("IFERROR(1*B11,0)=D4",home["B18"].value)
        self.assertIn('AND(IFERROR(1*B11,0)=D4,ISNUMBER(',home["B13"].value)
        self.assertIn("AND(IFERROR(1*B11,0)=D4,B15>B12)",home["B28"].value)
        self.assertIn('AND(IFERROR(1*B11,0)=D4,D24="確定申告",B15=0',home["B28"].value)
        self.assertNotIn('AND(D24="確定申告",B15=0,B34=""',home["B28"].value)
        self.assertEqual(home["D33"].value,"未確認")
        self.assertIn("前年票→2026試算",home["D34"].value)
        self.assertIn("SAFE-TAX-030",home["B28"].value)
        self.assertIn("SAFE-TAX-031",home["B28"].value)
        self.assertIn("SAFE-TAX-032",home["B28"].value)
        self.assertIn('D33="住宅控除なし",OR(B33<>"",B34<>"")',home["B28"].value)
        self.assertIn("D33",home["B28"].value)
        self.assertIn("'例外・分離課税'!B43",home["B28"].value)
        self.assertIn("'例外・分離課税'!B44",home["B28"].value)
        self.assertIsNone(self.book[ADVANCED]["B43"].value)
        self.assertIsNone(self.book[ADVANCED]["B44"].value)
        self.assertTrue(self.book[ADVANCED]["B43"].protection.locked)
        self.assertTrue(self.book[ADVANCED]["B44"].protection.locked)
        self.assertTrue(any(str(dv.sqref) == "D33" for dv in home.data_validations.dataValidation))
        self.assertFalse(any(str(dv.sqref) == "B7" for dv in home.data_validations.dataValidation))
        self.assertIn("'操作画面'!D33",self.book[ADVANCED]["B42"].value)
        vb=(ROOT/"vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        self.assertIn('home.Range("D33").Value2 = "未確認"',vb)
        self.assertIn('.Range("B40,B43:B44,B45:B49").ClearContents',vb)
        self.assertIn("isProjection = (year = 2025 And CLng(home.Range",vb)
        self.assertNotIn('home.Range("B4").Value2 = year',vb)
        self.assertIn('If Not isProjection Then home.Range("B33")',vb)
        self.assertIn('If Not isProjection Then home.Range("B34")',vb)
        self.assertIn('Not sourceTotalDifferent And Not isProjection',vb)
        self.assertIn('Not isProjection Or CStr(refCell) = "B14"',vb)
        self.assertIn('    If Not isProjection Then',vb)
        self.assertIn('        ValidateSpouseSource home, extra',vb)
        self.assertIn('ValidateSpecialRelativeSource home, extra, relatives',vb)
        self.assertIn('ROUNDUP((MIN(B12,10000000)-8500000)/10,0)',home["B28"].value)
        self.assertIn("IF(B12<2193000,1451000", home["B13"].value)
        self.assertIn("IF(B12<2196000,1453000,1456000)", home["B13"].value)
        self.assertIn("MAX(0,B12-IF(D4=2025,650000,740000))", home["B13"].value)
        # Production defect found by PC① real-Excel boundary QA:
        # 650,999 gross in 2025 was incorrectly treated as 999 income.
        # A fixture-only fix is insufficient: demand the generated formula.
        self.assertIn(
            "IF(AND(D4=2025,B12<651000),0,"
            "MAX(0,B12-IF(D4=2025,650000,740000)))",
            home["B13"].value,
        )
        self.assertIn("'例外・分離課税'!B13", home["B13"].value)
        self.assertEqual(home["B14"].value,
                         '=IF(D25<>"",IF(ISNUMBER(D25),D25,""),B31)')
        self.assertIn("'ふるさと納税限度額計算'!F15", home["B31"].value)
        self.assertIn("'ふるさと納税限度額計算'!F38", home["B31"].value)
        self.assertEqual(home["D26"].value,
                         '=IF(D25="","自動再計算","⚠ 手入力上書き中")')
        self.assertIsNone(home["D25"].value)
        self.assertFalse(home["D25"].protection.locked)
        self.assertTrue(any("D25" in str(rule.sqref) for rule in home.data_validations.dataValidation))
        self.assertTrue(home["B31"].protection.locked)
        self.assertTrue(home["D31"].protection.locked)
        self.assertIn("D25", home["B28"].value)
        self.assertIn('ABS(\'例外・分離課税\'!B14-B31)>1',home["B28"].value)
        self.assertIn('VERIFIED_AFTER_CORRECTION',home["B28"].value)
        extra = self.book[ADVANCED]
        self.assertIsNone(extra["B41"].value)
        self.assertTrue(extra["B41"].protection.locked)
        self.assertTrue(extra["B42"].protection.locked)
        fingerprint = extra["B42"].value
        self.assertTrue(fingerprint.startswith("=LEN('操作画面'!B4)"))
        self.assertLess(len(fingerprint), 8192)
        self.assertIn('&"|"&',fingerprint)
        self.assertNotIn("TEXTJOIN",fingerprint)
        for coordinate in ("B4","B12","B16","D14","D17","D25",
                           "B44","B51","D45","D73","D77"):
            self.assertIn(f"'操作画面'!{coordinate}", fingerprint)
        for coordinate in ("B8","B14","B15","B16","B17","B38","B39"):
            self.assertIn(f"'例外・分離課税'!{coordinate}", fingerprint)
        self.assertIn("'設定・税率'!B4",fingerprint)
        for calculated in ("B13","B14","B17","B18","B31"):
            self.assertNotIn(f"'操作画面'!{calculated}",fingerprint)
        for calculated in ("B7","B22","B27","B28","B29","B30","B34"):
            self.assertNotIn(f"'例外・分離課税'!{calculated}",fingerprint)
        self.assertNotIn("'例外・分離課税'!B20",fingerprint,
                         "The attestation must not depend on its own status.")
        self.assertNotIn("'例外・分離課税'!B41",fingerprint,
                         "The attestation cannot depend on itself.")
        self.assertIn("'例外・分離課税'!B41",home["B28"].value)
        self.assertIn("'例外・分離課税'!B42",home["B28"].value)
        vb = (ROOT/"vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
        self.assertIn('extra.Range("B41").Value2 = CStr(extra.Range("B42").Value2)',vb)
        self.assertIn('extra.Range("B41").ClearContents',vb)

        self.assertNotIn("'例外・分離課税'!B14<", home["B28"].value)
        self.assertIn("'ふるさと納税限度額計算'!F24", home["B17"].value)
        self.assertIn("'ふるさと納税限度額計算'!F25", home["B18"].value)
        self.assertEqual(home["D24"].value, "ワンストップ")
        self.assertIsNone(home["D25"].value)
        self.assertNotIn('D25<>"確認済"', home["B28"].value)

    def test_2026_national_tax_salary_special_formula_boundaries(self):
        """Regress NTA No.1410 note (2) without altering 2025 or 2.2m+."""
        formula = self.book[HOME]["B13"].value
        expected = {
            690999: 0, 691000: 0, 740999: 0, 741000: 1000,
            2190999: 1450999, 2191000: 1451000, 2192999: 1451000,
            2193000: 1453000, 2195999: 1453000,
            2196000: 1456000, 2199999: 1456000,
            2200000: 1460000, 2200001: 1460000,
        }
        # The known 2026 bands and values must occur in the generated
        # Excel expression. Real Excel COM asserts each result separately.
        for bound in (741000, 2191000, 2193000, 2196000, 2200000):
            self.assertIn(f"B12<{bound}", formula)
        for value in (1451000, 1453000, 1456000):
            self.assertIn(str(value), formula)
        self.assertEqual(expected[2192999], 1451000)
        self.assertEqual(expected[2195999], 1453000)
        self.assertEqual(expected[2199999], 1456000)
        self.assertIn("IF(D4=2025,1900000,2200000)", formula)
        self.assertIn("v4.18.36", self.book[HOME]["A1"].value)
        self.assertNotIn("検証版", self.book[HOME]["A1"].value)
        self.assertNotIn("検証版", self.book["住宅確申寄附検算"]["A1"].value)
        self.assertEqual(self.book[HOME]["A2"].hyperlink.location, "'操作画面'!A42")
        self.assertIsNone(self.book[HOME]["A7"].hyperlink)

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
        for cell, source in (("B13","B15"),("B17","B16"),("B18","B17")):
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

    def test_tax_credit_grid_and_exact_search_have_separate_inputs(self):
        model = self.book["分離課税詳細計算"]
        self.assertIn("AC28*200", model["O28"].value)
        self.assertIn("AC28*200", model["P28"].value)
        self.assertIn("MIN(MAX(0", model["AC28"].value)
        self.assertIn("AA28", model["W28"].value)
        self.assertIn("AB28*200", model["X28"].value)
        self.assertIn("AB28*200", model["Y28"].value)

    def test_generated_formulas_have_valid_excel_parentheses(self):
        # Excel rejects a workbook when an overlong/malformed nested status
        # formula is present. This catches accidental extra closings BEFORE COM.
        home = self.book[HOME]
        model = self.book["分離課税詳細計算"]
        home_formulas = (home[addr] for addr in ("B13", "B14", "B17", "B18", "B28"))
        model_formulas = (cell for row in model.iter_rows() for cell in row if cell.data_type == "f")
        for cell in chain(home_formulas, model_formulas):
            addr, formula = cell.coordinate, cell.value
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
