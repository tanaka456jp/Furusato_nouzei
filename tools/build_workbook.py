"""Build the review workbook from the unmodified v3 template."""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory

from openpyxl import load_workbook
from openpyxl.workbook.properties import CalcProperties
from openpyxl.styles import Alignment, Font, PatternFill, Protection
from openpyxl.formatting.rule import FormulaRule
from openpyxl.worksheet.page import PageMargins
from openpyxl.worksheet.datavalidation import DataValidation
from rebuild_xlsx import reconstruct
from separate_tax_sheet import add_separate_tax
from openpyxl.worksheet.hyperlink import Hyperlink

ROOT = Path(__file__).resolve().parents[1]
HOME = "操作画面"
ENGINE = "ふるさと納税限度額計算"
INPUT = "源泉徴収票入力"
RESIDENT = "住民税再計算"
DETAIL = "計算根拠"
ADVANCED = "例外・分離課税"
SPLIT_ALLOC = "分離課税寄附控除"
RELATIVES = "特定親族明細"
RELATIVE_LAST_ROW = 33  # 30 separately attested relatives; first three use home D14:D16



def ref(sheet, address):
    return f"'{sheet}'!{address}"


def income_tax_progressive(taxable):
    """National income tax for 2025/2026, after the ¥1,000 taxable-income floor.

    The approved 2025/2026 brackets are fixed for this reviewed version.
    The 2.1% reconstruction income tax is applied to the tax *difference*
    after ordinary and split taxable amounts have been recomputed.
    """
    x = f"ROUNDDOWN(MAX(0,{taxable}),-3)"
    return (
        f"MAX(0,ROUNDDOWN(IF({x}<=1950000,{x}*0.05,"
        f"IF({x}<=3300000,{x}*0.1-97500,"
        f"IF({x}<=6950000,{x}*0.2-427500,"
        f"IF({x}<=9000000,{x}*0.23-636000,"
        f"IF({x}<=18000000,{x}*0.33-1536000,"
        f"IF({x}<=40000000,{x}*0.4-2796000,"
        f"{x}*0.45-4796000)))))),0))"
    )


def build(source, output):
    # The frozen source contains overlapping A71:I71 and E71:F71 merges.
    # Repackage without modifying source, formulas, or tax-master values.
    # Windows Excel rejects the original OOXML but accepts a fresh copy.
    with TemporaryDirectory(prefix="furusato_xlsx_sanitize_") as folder:
        safe_source = Path(folder) / "sanitized_source.xlsx"
        reconstruct(Path(source), safe_source, styles=True, layout=True)
        book = load_workbook(safe_source)
    del book[HOME]
    home = book.create_sheet(HOME, 0)
    relatives = book.create_sheet(RELATIVES, 1)
    detail = book.create_sheet(DETAIL)
    extra = book.create_sheet(ADVANCED)
    split = book.create_sheet(SPLIT_ALLOC)
    extra.sheet_view.showGridLines = False
    extra.column_dimensions["A"].width = 42
    extra.column_dimensions["B"].width = 25
    extra.sheet_view.zoomScale = 85
    extra.column_dimensions["C"].width = 34
    extra.column_dimensions["D"].width = 20
    extra.sheet_properties.pageSetUpPr.fitToPage = True
    extra.page_setup.fitToWidth = 1
    extra.page_setup.fitToHeight = 1
    extra.page_setup.orientation = "portrait"
    extra.page_setup.paperSize = extra.PAPERSIZE_A4
    extra.print_area = "A1:D25"
    original, withholding, resident = (book[name] for name in (ENGINE, INPUT, RESIDENT))

    for view, widths in ((home, (33, 16, 32, 18)), (detail, (33, 16, 32, 18))):
        view.sheet_view.showGridLines = False
        view.sheet_view.zoomScale = 85
        for col, width in zip("ABCD", widths):
            view.column_dimensions[col].width = width
        view.sheet_properties.pageSetUpPr.fitToPage = True
        view.page_setup.fitToWidth = 1
        view.page_setup.fitToHeight = 1
        view.page_setup.paperSize = view.PAPERSIZE_A4
        view.page_setup.orientation = "portrait"
        view.page_margins = PageMargins(
            left=0.28, right=0.28, top=0.38, bottom=0.38,
            header=0.15, footer=0.15,
        )
        view.print_options.horizontalCentered = True
        view.print_options.gridLines = False

    def bar(sheet, row, text):
        sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
        cell = sheet.cell(row, 1, text)
        cell.fill = PatternFill("solid", fgColor="163A56")
        cell.font = Font(name="Yu Gothic", size=12, bold=True, color="FFFFFF")
        sheet.row_dimensions[row].height = 23

    def note(sheet, row, value):
        sheet.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
        sheet.cell(row, 1, value).alignment = Alignment(wrap_text=True, vertical="center")
        sheet.row_dimensions[row].height = 30

    def field(cell, label, value=None, choices=None, maximum=100_000_000):
        row, col = home[cell].row, home[cell].column
        home.cell(row, col - 1, label).alignment = Alignment(wrap_text=True, vertical="center")
        home.row_dimensions[row].height = 27
        home[cell] = value
        home[cell].fill = PatternFill("solid", fgColor="E2F2FF")
        home[cell].protection = Protection(locked=False)
        home[cell].alignment = Alignment(horizontal="right", vertical="center")
        if choices:
            validation = DataValidation(type="list", formula1='"' + ",".join(choices) + '"')
        else:
            home[cell].number_format = '#,##0'
            validation = DataValidation(type="whole", operator="between", formula1=0, formula2=maximum)
        validation.showErrorMessage = True
        validation.errorTitle = "入力を確認してください"
        validation.error = "選択肢から選ぶか、指定範囲の整数を入力してください。"
        home.add_data_validation(validation)
        validation.add(home[cell])

    bar(home, 1, "ふるさと納税 寄附限度額試算    v4.18.34 分離課税検証版")
    bar(extra, 1, "追加所得・分離課税（所得年内で事前試算）")
    extra.merge_cells("A3:D3")
    extra["A3"] = "翌年度の住民税通知書は参照せず、所得年内の収入・経費・控除と法定税率表から計算します。"
    extra["A3"].alignment = Alignment(wrap_text=True)
    extra.row_dimensions[3].height = 35
    extra_items = (
        (4, "案件区分（自動）", None, None),
        (5, "公的年金等の年間収入（円）", None, None),
        (6, "公的年金受給者の年齢区分（所得年末）", None, ("65歳未満", "65歳以上")),
        (7, "公的年金等の雑所得（自動）", None, None),
        (8, "業務に係る雑所得：年間収入", None, None),
        (9, "業務に係る雑所得：必要経費", None, None),
        (10, "その他の雑所得：年間収入", None, None),
        (11, "その他の雑所得：必要経費", None, None),
        (12, "事業・不動産所得：所得額（経費控除後）", None, None),
        (13, "所得金額調整控除額（原票・照合）", None, None),
        (14, "源泉票：所得控除合計額（照合のみ）", None, None),
        (15, "源泉票：給与所得控除後の額（照合）", None, None),
        (16, "源泉票：生命保険料控除額（照合）", None, None),
        (17, "源泉票：地震保険料控除額（照合）", None, None),
        (18, "源泉票：源泉徴収税額（照合）", None, None),
        (19, "読取方式（自動設定）", None, None),
        (20, "源泉票取込の確認状態（自動設定）", None, None),
        (21, "旧長期損害保険料の支払額（別途確認）", None, None),
        (22, "特例割合判定の所得税率（自動）", None, None),
        (24, "申告分離課税の課税所得", None, None),
        (25, "分離所得の種類", "なし", ("なし", "上場株式", "土地建物長期", "土地建物短期", "先物", "その他")),
        (26, "その他の総合課税所得（所得額）", None, None),
        (27, "分離課税の住民税所得割（自動）", None, None),
        (28, "追加所得の合計（調整控除後・自動）", None, None),
        (29, "給与と年金の所得金額調整控除（自動）", None, None),
        (30, "給与等と追加所得の合計（自動）", None, None),
        (32, "源泉票読取の確認事項（自動設定）", None, None),
        (33, "分離課税の特例・繰越損失等", "なし", ("なし", "あり")),
        (34, "分離課税の所得税率（自動）", None, None),
        (36, "分離所得の控除前額（任意・限度判定）", None, None),
        (38, "特定親族の人数（源泉票G72・照合）", None, None),
        (39, "特定親族特別控除額（源泉票G74・照合）", None, None),
        (40, "配偶者の合計所得（源泉票G43・照合）", None, None),
    )
    for row, label, initial, choices in extra_items:
        extra[f"A{row}"] = label
        extra[f"A{row}"].alignment = Alignment(wrap_text=True, vertical="center")
        extra[f"B{row}"] = initial
        extra.row_dimensions[row].height = 27
        if row not in (4, 7, 19, 20, 22, 27, 28, 29, 30, 32, 34, 38, 39, 40):
            extra[f"B{row}"].fill = PatternFill("solid", fgColor="E2F2FF")
            extra[f"B{row}"].protection = Protection(locked=False)
            extra[f"B{row}"].number_format = '#,##0'
            if choices:
                dv = DataValidation(type="list", formula1='"' + ",".join(choices) + '"')
            else:
                dv = DataValidation(type="whole", operator="between", formula1=0, formula2=1000000000)
            dv.showErrorMessage = True
            extra.add_data_validation(dv)
            dv.add(extra[f"B{row}"])
    # Case classification is deduced from supplied taxable split income,
    # never from a redundant "normal/exception" operator attestation.
    extra["B4"] = '=IF(N(B24)>0,"分離課税","通常")'
    extra["B4"].fill = PatternFill("solid", fgColor="EAF3EA")
    extra["B4"].protection = Protection(locked=True)
    extra["B4"].font = Font(name="Yu Gothic", bold=True, color="226044")
    extra["B4"].alignment = Alignment(horizontal="right", vertical="center")
    # Excel formulas calculate pension taxable income and the adjustment for
    # taxpayers with both salary and public pension income.
    nonpension = (
        f'N({ref(HOME,"B13")})+'
        'MAX(0,N(B8)-N(B9))+MAX(0,N(B10)-N(B11))+N(B12)+N(B26)'
    )
    pension_brackets = (
        'IF(B5<IF(B6="65歳以上",3300000,1300000),'
        'B5-IF(B6="65歳以上",1100000,600000),'
        'IF(B5<4100000,B5*0.75-275000,'
        'IF(B5<7700000,B5*0.85-685000,'
        'IF(B5<10000000,B5*0.95-1455000,B5-1955000))))'
    )
    extra["B7"] = (
        '=IF(OR(B5="",B5=0),0,IF(B6="","",MAX(0,ROUNDDOWN('
        + pension_brackets + '+'
        + f'IF({nonpension}>20000000,200000,IF({nonpension}>10000000,100000,0))'
        + ',0))))'
    )
    extra["B29"] = f'=IF(B7="","",MAX(0,MIN(100000,N({ref(HOME,"B13")}))+MIN(100000,N(B7))-100000))'
    extra["B28"] = (
        '=IF(B7="","",MAX(0,N(B7)+MAX(0,N(B8)-N(B9))+'
        'MAX(0,N(B10)-N(B11))+N(B12)+N(B26)-N(B29)))'
    )
    extra["B30"] = f'=IF(B28="","",N({ref(HOME,"B13")})+B28)'
    extra["B22"] = f'=IF({ref(RESIDENT,"B21")}="","",{ref(RESIDENT,"B21")})'
    # Use the *taxable* split-income amount, not the proceeds before costs.
    # No special deductions, carryforwards or reduced rates in this path.
    extra["B27"] = ('=IF(N(B24)=0,0,IF(OR(B25="上場株式",'
                     'B25="土地建物長期",B25="先物"),ROUNDDOWN(B24*0.05,0),'
                     'IF(B25="土地建物短期",ROUNDDOWN(B24*0.09,0),"")))')
    extra["B34"] = ('=IF(N(B24)=0,0,IF(B25="土地建物短期",0.3,'
                     'IF(OR(B25="上場株式",B25="土地建物長期",'
                     'B25="先物"),0.15,"")))')
    for address in ("B7", "B22", "B27", "B28", "B29", "B30", "B34"):
        cell = extra[address]
        cell.fill = PatternFill("solid", fgColor="EAF3EA")
        cell.protection = Protection(locked=True)
        cell.font = Font(name="Yu Gothic", bold=True, color="226044")
        cell.alignment = Alignment(horizontal="right", vertical="center")
        cell.number_format = "0.0%" if address in ("B22","B34") else '#,##0'
    extra.merge_cells("A23:D23")
    extra["A23"] = "通常の申告分離課税は所得割5%（短期土地建物9%）を自動加算。申告不要の上場株式等は入力しません。"
    extra["A23"].alignment = Alignment(wrap_text=True)
    extra.row_dimensions[23].height = 34
    extra.merge_cells("A31:D31")
    extra["A31"] = "B24は旧入力です。分離課税は操作画面の詳細設定で控除前の所得と税目別控除を入力してください。"
    extra["A31"].alignment = Alignment(wrap_text=True)
    extra.row_dimensions[31].height = 36
    extra.row_dimensions[32].height = 42
    extra["B32"].alignment = Alignment(wrap_text=True)
    extra.merge_cells("A35:D35")
    extra["A35"] = "申告分離課税として申告する所得のみ。NISA・申告不要の特定口座は加算しません。"
    extra["A35"].alignment = Alignment(wrap_text=True)
    extra.row_dimensions[35].height = 33
    extra["A37"] = "B24は所得控除適用後の分離課税課税所得です。B36が不明ならB24を控除上限の保守的な所得基準に使用します。"
    extra.merge_cells("A37:D37")
    extra["A37"].alignment = Alignment(wrap_text=True)
    extra.row_dimensions[37].height = 34
    for addr in ("B38", "B39", "B40"):
        extra[addr].fill = PatternFill("solid", fgColor="EAF3EA")
        extra[addr].protection = Protection(locked=True)
        extra[addr].alignment = Alignment(horizontal="right")
        extra[addr].number_format = "#,##0"
    # Source attestation is valid for the exact reviewed INPUT snapshot only.
    # VBA persists B42 in B41 on explicit review; every relevant edited
    # number, relative's income, tax year and source value changes B42. The
    # independent stamp never includes its own review status or B41/B42.
    fingerprint_home = (
        # Input ONLY. No B13/B14/B17/B18/B31: calculated values may depend
        # on this review gate, so referencing them can cause a circular
        # calculation and block even otherwise-valid source-free cases.
        ["B4", "B7", "B11", "B12", "B15", "B16"]
        + [f"B{i}" for i in range(19, 26)]
        + [f"D{i}" for i in range(11, 26)]
        + ["B33", "B34", "B35", "B36", "D35", "D24"]
        # Separate-tax controls may alter the applicability of a reviewed
        # source; do not reuse source verification across case-mode changes.
        + [f"B{i}" for i in range(44, 52)]
        + [f"D{i}" for i in range(44, 52)]
        + [f"D{i}" for i in range(72, 78)]
    )
    fingerprint_extra = (
        # B7/B22/B27-B30/B34 are formula results, never snapshot drivers.
        [f"B{i}" for i in (5,6,8,9,10,11,12,13,14,15,16,17,18)]
        + ["B19", "B21", "B24", "B25", "B26",
           "B32", "B33", "B36", "B38", "B39", "B40", "B43", "B44"]
    )
    fingerprint_fields = (
        [ref(HOME, cell) for cell in fingerprint_home]
        + [ref(ADVANCED, cell) for cell in fingerprint_extra]
        + [ref("設定・税率", "B4")]
        + [ref(RELATIVES, f"{column}{row}")
           for row in range(4, RELATIVE_LAST_ROW + 1)
           for column in (("B", "D") if row <= 6 else ("B", "C", "D"))]
    )
    extra["A41"] = "読取確認時の入力スナップショット（自動保存）"
    extra["A42"] = "現在の入力スナップショット（自動更新）"
    extra["A43"] = "前年原票：住宅ローン控除の所得税適用額（照合のみ）"
    extra["A44"] = "前年原票：住宅ローン控除可能額（照合のみ）"
    extra["B43"] = None
    extra["B44"] = None
    for cell in ("B43", "B44"):
        extra[cell].protection = Protection(locked=True)
        extra[cell].number_format = '#,##0'
    extra["B41"] = None
    # A plain delimiter alone is ambiguous: "a|b" and "a","b" could
    # serialize to the same text even though the reviewed inputs changed.
    # Prefix EACH input with its length. LEN + & work in old desktop Excel
    # without TEXTJOIN/_xlfn compatibility risks and stay under 8,192 chars.
    snapshot_segments = [f'LEN({cell})&":"&{cell}' for cell in fingerprint_fields]
    snapshot_formula = "=" + '&"|"&'.join(snapshot_segments)
    if len(snapshot_formula) > 8192:
        raise AssertionError("Source review fingerprint exceeded Excel's formula length limit")
    extra["B42"] = snapshot_formula
    for addr in ("B41", "B42"):
        extra[addr].protection = Protection(locked=True)
        extra[addr].number_format = "@"
    extra.row_dimensions[41].hidden = True
    extra.row_dimensions[42].hidden = True
    extra.print_area = "A1:D40"
    home.row_dimensions[3].height = 28
    field("B4", "計算対象の所得年", "2026", ("2025", "2026"))
    home["C4"], home["D4"] = "適用中の所得年", "=" + ref("設定・税率", "B4")
    home["C5"], home["D5"] = "住民税課税年度", "=" + ref(RESIDENT, "B5")
    note(home, 6, '="税制版 "&B29&" ｜ "&B30')
    home["B29"] = "2026-11-05-bundled"
    home.merge_cells("A2:D2")
    home["A2"] = "詳細設定・申告分離課税へ"
    home["A2"].hyperlink = Hyperlink(ref="A2", location="'操作画面'!A42")
    home["A2"].style = "Hyperlink"
    home["A2"].alignment = Alignment(vertical="center")
    home.row_dimensions[2].height = 25
    home["B30"] = "内蔵マスタ"
    home.row_dimensions[29].hidden = True
    home.row_dimensions[30].hidden = True
    # The source slip year (B11) may be 2025 while the selected tax
    # master (D4) is 2026. Acknowledgement is required before any result.
    field("B7", "翌年試算の前提確認", "未確認",
          ("未確認", "確認済", "住宅控除なし"))
    home["C7"] = "原票・試算年の関係"
    home["D7"] = ('=IF(IFERROR(1*B11,0)=D4,"同一年分",'
                   'IF(AND(IFERROR(1*B11,0)=2025,D4=2026),'
                   '"前年票→2026試算","年分不一致"))')
    home["D7"].protection = Protection(locked=True)
    home["D7"].alignment = Alignment(horizontal="center")
    home["D7"].fill = PatternFill("solid", fgColor="EAF3EA")
    for row in (5, 7, 8):
        home.row_dimensions[row].height = 25
    detail.row_dimensions[17].height = 26
    home["A8"], home["C8"] = "寄附限度額の目安（円）", "調整控除後の所得割（円）"
    for cell, target in (("B8", "B26"), ("D8", "B16")):
        home[cell] = f'=IF(B28<>"正常","",{ref(RESIDENT, target)})'
        home[cell].number_format = '#,##0'
        home[cell].alignment = Alignment(horizontal="right")
        home[cell].font = Font(name="Yu Gothic", bold=True, size=15, color="163A56")
    note(home, 9, '=B28')
    home.row_dimensions[9].height = 40
    home.conditional_formatting.add(
        "A9:D9",
        FormulaRule(
            formula=['AND($B$28<>"正常",$B$28<>"")'],
            fill=PatternFill("solid", fgColor="FCE8E6"),
            font=Font(name="Yu Gothic", bold=True, color="A4242D"),
        ),
    )
    home.conditional_formatting.add(
        "A9:D9",
        FormulaRule(
            formula=['$B$28="正常"'],
            fill=PatternFill("solid", fgColor="EAF5ED"),
            font=Font(name="Yu Gothic", bold=True, color="206E40"),
        ),
    )
    bar(home, 10, "源泉徴収票から転記・該当する控除の内訳")
    field("B11", "源泉徴収票の所得年", "2026", ("2025", "2026"))
    labels = [
        "支払金額", "給与所得控除後の金額（調整控除後）", "所得控除の額の合計額", "源泉徴収税額",
        "社会保険料等の金額（総額）", "生命保険料の控除額", "地震保険料の控除額",
    ]
    for row, label in enumerate(labels, 12):
        field(f"B{row}", label)
    for row, label in enumerate(("新生命保険料", "旧生命保険料", "新個人年金保険料", "旧個人年金保険料",
                                 "介護医療保険料", "地震保険料の支払額"), 19):
        field(f"B{row}", label)
    field("B25", "23歳未満の扶養親族", "なし", ("あり", "なし"))
    # Explicit manual "eligible/ineligible" toggle is removed. B26 now
    # displays a read-only consequence of the existing substantive checks.
    # B28 MUST NOT refer to B26, otherwise a circular dependency arises.
    home["A26"] = "計算可否（入力から自動判定）"
    home["A26"].alignment = Alignment(wrap_text=True, vertical="center")
    home.row_dimensions[26].height = 27
    home["B26"] = ('=IF(COUNT(B12,B15,B16)<3,"入力待ち",'
                    'IF(B28="正常","計算可能","追加確認"))')
    home["B26"].fill = PatternFill("solid", fgColor="EAF3EA")
    home["B26"].font = Font(name="Yu Gothic", color="226044", bold=True)
    home["B26"].alignment = Alignment(horizontal="right", vertical="center")
    home["B26"].protection = Protection(locked=True)
    for row, label in enumerate(("一般扶養（人数）", "同居老親（人数）", "その他の老人扶養（人数）"), 11):
        field(f"D{row}", label, maximum=30)
    for row, label in enumerate(("特定親族1の合計所得", "特定親族2の合計所得", "特定親族3の合計所得",
                                 "配偶者の合計所得（70歳未満）", "配偶者の合計所得（70歳以上）"), 14):
        field(f"D{row}", label)
    for row, label in enumerate(("普通障害（人数）", "特別障害（人数）", "同居特別障害（人数）"), 19):
        field(f"D{row}", label, maximum=30)
    field("D22", "本人の控除区分", "該当なし", ("該当なし", "寡婦", "ひとり親（母）", "ひとり親（父）", "勤労学生"))
    field("D23", "16歳未満の扶養（人数）", maximum=30)
    field("D24", "申告方式", "ワンストップ", ("ワンストップ", "確定申告"))
    # The source slip's total stays in ADVANCED B14 for audit only. D25 is
    # the user's independent manual override; clearing it restores auto.
    field("D25", "所得控除合計（手入力上書き）")
    home["C25"].font = Font(name="Yu Gothic", bold=True, color="9C4100")
    home["D25"].fill = PatternFill("solid", fgColor="FFF0C2")
    home["C26"] = "所得控除額の計算状態"
    home["C26"].alignment = Alignment(wrap_text=True)
    home["D26"] = '=IF(D25="","自動再計算","⚠ 手入力上書き中")'
    home["D26"].font = Font(name="Yu Gothic", bold=True, color="9C4100")
    home["D26"].alignment = Alignment(wrap_text=True)
    home["D26"].protection = Protection(locked=True)
    home.row_dimensions[26].height = 38
    note(home, 27, '=IF(D25<>"","⚠ 所得控除合計は手入力上書き中です。D25を消すと自動計算に戻ります。",IF(AND(IFERROR(1*B11,0)=2025,D4=2026),"前年原票の所得控除合計は照合用です。令和8年の基礎・扶養等の控除を再計算します。行7の条件確認と読取内容の確認が必要です。","所得控除合計は社会保険料・扶養・配偶者等の変更により自動再計算します。D25で手入力上書きが可能です。"))')
    home.row_dimensions[27].height = 56
    home["A31"] = "所得控除合計（自動算定）"
    home["B31"] = ('=IF(OR(B13="",B16=""),"",'
                   f'SUM(B16:B18,{ref(ENGINE,"F15")},'
                   f'{ref(ENGINE,"F38")},{ref("追加人的控除","C12")}))')
    home["C31"] = "所得控除合計（原票記載）"
    home["D31"] = f'=IF(ISNUMBER({ref(ADVANCED,"B14")}),{ref(ADVANCED,"B14")},"")'
    for a in ("A31","C31"):
        home[a].alignment = Alignment(wrap_text=True, vertical="center")
    for a in ("B31","D31"):
        home[a].number_format = '#,##0'
        home[a].fill = PatternFill("solid", fgColor="EAF3EA")
        home[a].protection = Protection(locked=True)
        home[a].alignment = Alignment(horizontal="right")
    home.row_dimensions[31].height = 42
    for region in ("A14:B14", "C25:D26", "A27:D27"):
        home.conditional_formatting.add(region,
            FormulaRule(formula=['ISNUMBER($D$25)'],
                fill=PatternFill("solid", fgColor="FFF0C2"),
                font=Font(name="Yu Gothic", bold=True, color="9C4100")))
    # Separate every special-age relative's income and legal eligibility.
    # The first three retain the existing home input cells; remaining relatives
    # are entered on this visible sheet.  No unconfirmed person gets an amount.
    relatives.sheet_view.showGridLines = False
    relatives.sheet_view.zoomScale = 90
    for column, width in {"A": 8, "B": 19, "C": 24, "D": 21,
                          "E": 18, "F": 18, "G": 25, "H": 43}.items():
        relatives.column_dimensions[column].width = width
    relatives.merge_cells("A1:H1")
    relatives["A1"] = "特定扶養親族・特定親族特別控除｜個別計算（最大30人）"
    relatives["A1"].font = Font(name="Yu Gothic", size=13, bold=True, color="FFFFFF")
    relatives["A1"].fill = PatternFill("solid", fgColor="163A56")
    relatives.row_dimensions[1].height = 27
    relatives.merge_cells("A2:H2")
    relatives["A2"] = ("年齢は所得年12月31日時点。確認済＝19～22歳・生計同一・"
                      "他の納税者との重複適用なし・専従者等に該当しないことを証憑で確認。"
                      "1～3人目の所得は操作画面D14:D16と連動します。")
    relatives["A2"].alignment = Alignment(wrap_text=True, vertical="center")
    relatives.row_dimensions[2].height = 45
    for column, title in zip("ABCDEFGH", (
        "No.", "年末年齢", "年間合計所得（円）", "適用要件",
        "所得税控除（円）", "住民税控除（円）", "適用区分", "確認事項"
    )):
        cell = relatives[f"{column}3"]
        cell.value = title
        cell.fill = PatternFill("solid", fgColor="163A56")
        cell.font = Font(name="Yu Gothic", bold=True, color="FFFFFF")
        cell.alignment = Alignment(wrap_text=True)
    relatives.row_dimensions[3].height = 30
    relatives.freeze_panes = "C4"
    age_rule = DataValidation(type="whole", operator="between",
                              formula1=0, formula2=120)
    income_rule = DataValidation(type="whole", operator="between",
                                 formula1=0, formula2=100000000)
    status_rule = DataValidation(
        type="list", formula1='"未確認,要件確認済,対象外"')
    for validation in (age_rule, income_rule, status_rule):
        validation.showErrorMessage = True
        validation.errorTitle = "特定親族の入力を確認してください"
        validation.error = "年末年齢・各人の合計所得・適用要件を確認してください。"
        relatives.add_data_validation(validation)
    tax_year = ref(HOME, "D4")
    special_income = lambda c: (
        f'IF({c}<=850000,630000,IF({c}<=900000,610000,'
        f'IF({c}<=950000,510000,IF({c}<=1000000,410000,'
        f'IF({c}<=1050000,310000,IF({c}<=1100000,210000,'
        f'IF({c}<=1150000,110000,IF({c}<=1200000,60000,'
        f'IF({c}<=1230000,30000,0)))))))))'
    )
    special_resident = lambda c: (
        f'IF({c}<=950000,450000,IF({c}<=1000000,410000,'
        f'IF({c}<=1050000,310000,IF({c}<=1100000,210000,'
        f'IF({c}<=1150000,110000,IF({c}<=1200000,60000,'
        f'IF({c}<=1230000,30000,0)))))))'
    )
    for row in range(4, RELATIVE_LAST_ROW + 1):
        person = row - 3
        relatives[f"A{row}"] = person
        relatives[f"D{row}"] = "未確認"
        if person <= 3:
            source = ref(HOME, f"D{row+10}")
            relatives[f"C{row}"] = f'=IF({source}="","",{source})'
            relatives[f"C{row}"].fill = PatternFill("solid", fgColor="EAF3EA")
            relatives[f"C{row}"].protection = Protection(locked=True)
        else:
            relatives[f"C{row}"].fill = PatternFill("solid", fgColor="E2F2FF")
            relatives[f"C{row}"].protection = Protection(locked=False)
            income_rule.add(relatives[f"C{row}"])
        for col in ("B", "D"):
            cell = relatives[f"{col}{row}"]
            cell.fill = PatternFill("solid", fgColor="E2F2FF")
            cell.protection = Protection(locked=False)
        age_rule.add(relatives[f"B{row}"])
        status_rule.add(relatives[f"D{row}"])
        category = (
            f'=IF(AND(B{row}="",C{row}="",D{row}="未確認"),"未入力",'
            f'IF(D{row}="対象外","対象外",'
            f'IF(OR(B{row}="",C{row}="",D{row}<>"要件確認済",'
            f'NOT(ISNUMBER(B{row})),NOT(ISNUMBER(C{row}))),"要確認",'
            f'IF(OR(B{row}<19,B{row}>22,B{row}<>INT(B{row}),'
            f'C{row}<0,C{row}<>INT(C{row})),"要確認",'
            f'IF(C{row}>1230000,"対象外",'
            f'IF(C{row}<=IF({tax_year}=2025,580000,620000),'
            '"特定扶養親族","特定親族特別控除"))))))'
        )
        relatives[f"G{row}"] = category
        relatives[f"E{row}"] = (
            f'=IF(G{row}="特定扶養親族",630000,'
            f'IF(G{row}="特定親族特別控除",{special_income(f"C{row}")},0))'
        )
        relatives[f"F{row}"] = (
            f'=IF(G{row}="特定扶養親族",450000,'
            f'IF(G{row}="特定親族特別控除",{special_resident(f"C{row}")},0))'
        )
        relatives[f"H{row}"] = (
            f'=IF(G{row}="要確認","要確認：年齢・各人所得・生計同一等",'
            f'IF(G{row}="対象外","適用対象外",""))'
        )
        for column in ("E","F"):
            cell = relatives[f"{column}{row}"]
            cell.number_format = "#,##0"
            cell.fill = PatternFill("solid", fgColor="EAF3EA")
            cell.protection = Protection(locked=True)
        relatives.row_dimensions[row].height = 22
    relatives["D35"] = "控除額合計"
    relatives["E35"] = f"=SUM(E4:E{RELATIVE_LAST_ROW})"
    relatives["F35"] = f"=SUM(F4:F{RELATIVE_LAST_ROW})"
    relatives["D36"] = "特定親族特別控除人数"
    relatives["E36"] = f'=COUNTIF(G4:G{RELATIVE_LAST_ROW},"特定親族特別控除")'
    relatives["D37"] = "特定親族特別控除（所得税）"
    relatives["E37"] = f'=SUMIF(G4:G{RELATIVE_LAST_ROW},"特定親族特別控除",E4:E{RELATIVE_LAST_ROW})'
    relatives["D38"] = "未確認人数"
    relatives["E38"] = f'=COUNTIF(G4:G{RELATIVE_LAST_ROW},"要確認")'
    relatives["A40"] = "操作画面に戻る"
    relatives["A40"].hyperlink = Hyperlink(ref="A40", location="'操作画面'!A1")
    relatives["A40"].style = "Hyperlink"
    relatives.print_area = f"A1:H{RELATIVE_LAST_ROW}"
    relatives.sheet_properties.pageSetUpPr.fitToPage = True
    relatives.page_setup.fitToWidth = 1
    relatives.page_setup.fitToHeight = 2
    relatives.page_setup.paperSize = relatives.PAPERSIZE_A4
    relatives.page_setup.orientation = "landscape"
    # B3 and C3 are occupied by source-import/review form controls; never
    # merge A3:D3, or Excel buttons would be overlaid/obscured.
    home["A3"] = "特定扶養・特定親族 明細（30人）"
    home["A3"].hyperlink = Hyperlink(ref="A3", location="'特定親族明細'!A1")
    home["A3"].style = "Hyperlink"
    home["A3"].alignment = Alignment(vertical="center")
    # Replace the three legacy XLOOKUP amount calculations, whose tax
    # and legal-eligibility state were not independently checked.
    for person in range(3):
        eng_row, rel_row = 32 + person, 4 + person
        original[f"F{eng_row}"] = "=" + ref(RELATIVES, f"E{rel_row}")
        original[f"H{eng_row}"] = "=" + ref(RELATIVES, f"F{rel_row}")
    # The old engine totals F28:F37 and H28:H37 cover persons 1..3.
    # Append only persons 4..30; no duplicate deductions.
    original["F38"] = f"=SUM(F28:F37)+SUM({ref(RELATIVES,'E7:E33')})"
    original["H38"] = f"=SUM(H28:H37)+SUM({ref(RELATIVES,'F7:F33')})"

    bar(home, 32, "住宅ローン控除（通常処理・源泉徴収票から転記）")
    field("B33", "住宅ローン控除の所得税適用額")
    field("B34", "住宅ローン控除可能額（G36）")
    field("B35", "居住開始年（西暦）", maximum=2035)
    field("D35", "2022年入居の特例区分", "未確認",
          ("未確認", "通常5%確認", "経過措置7%確認"))
    # Tax-law eligibility is not derivable from a withholding statement.
    # Show the statutory conditions in Excel's native input guidance
    # rather than silently treating a selected 7% rate as eligibility proof.
    for rule in home.data_validations.dataValidation:
        if str(rule.sqref) == "D35":
            rule.showInputMessage = True
            rule.promptTitle = "2022年入居・7%経過措置"
            rule.prompt = (
                "7%は消費税10%の住宅取得と所定の契約時期等が条件。"
                "新築2020/10～2021/9、建売・中古・増改築2020/12～2021/11。"
                "原資料未確認なら「未確認」を選択。"
            )
            break
    else:
        raise AssertionError("Missing D35 2022 mortgage classification validation")
    field("B36", "住宅ローン控除適用数", maximum=3)
    note(home, 37, "可能額と所得税適用額は別物です。控除可能額があって適用額が空欄なら、原票確認まで試算額を表示しません。")
    home["A38"] = "住民税住宅ローン控除見込額"
    # From 2026 resident-tax year, the ordinary 5% housing-credit cap for
    # occupancies through 2025 uses taxable national total PLUS the excess
    # of the national basic deduction over the former ¥480,000 baseline.
    # The 2026-occupancy cap is defined on the taxable total itself.
    # J12 includes ordinary pension/business income; B13-B14 does not.
    mortgage_taxable = f'N({ref(ENGINE,"J12")})'
    mortgage_basic_delta = f'MAX(0,N({ref(ENGINE,"F15")})-480000)'
    # 2022 occupancy can be 5%/97,500 or an exceptional 7%/136,500.
    # No tax-credit amount is displayed before the operator identifies
    # which legal acquisition/contract conditions the source proves.
    housing_2022_seven = 'AND(B35=2022,D35="経過措置7%確認")'
    housing_2022_unknown = (
        'AND(B35=2022,NOT(OR(D35="通常5%確認",D35="経過措置7%確認")))'
    )
    home["B38"] = (
        '=IF(B34="",0,IF(' + housing_2022_unknown + ',"",'
        'IF(AND(ISNUMBER(B33),ISNUMBER(B35),B35>=2022,B35<=D4),'
        f'MIN(MAX(0,B34-B33),IF({housing_2022_seven},136500,97500),'
        f'ROUNDDOWN(MAX(0,{mortgage_taxable}+'
        f'IF(B35>=2026,0,{mortgage_basic_delta}))/1000,0)*'
        f'IF({housing_2022_seven},70,50)),"")))'
    )
    home["B38"].number_format = '#,##0'
    home["B38"].fill = PatternFill("solid", fgColor="EAF3EA")
    home["B38"].protection = Protection(locked=True)
    note(home, 39, "2022年入居は契約・取得条件で通常5%／経過措置7%を必ず選択（未確認は停止）。2025・2026年分は所得税基礎控除差を反映。その他の特例・複数適用は個別照合。")
    home.row_dimensions[39].height = 36
    home.print_area = "A1:D39"

    def link(sheet, dest, src):
        target = ref(HOME, src)
        sheet[dest] = f'=IF({target}="","",{target})'

    for row in range(7, 11):
        link(withholding, f"B{row}", f"B{row + 5}")
    # Reuse native salary+other-ordinary-income calculations, not a separate
    # ad-hoc resident-tax amount or next year's notice.
    withholding["B11"] = f'=IF({ref(ADVANCED,"B28")}="","",{ref(ADVANCED,"B28")})'
    withholding["B25"] = f'=IF({ref(HOME, "B25")}="あり","該当あり",IF({ref(HOME, "B25")}="なし","該当なし","未確認"))'
    withholding["B22"] = f'=IF({ref(HOME, "B26")}="該当なし","確認済","未確認")'
    for row, source_row in zip((17, 18, 20, 21, 23, 25), range(19, 25)):
        link(original, f"D{row}", f"B{source_row}")
    for row, source_row in zip((28, 29, 30, 32, 33, 34, 36, 37), range(11, 19)):
        link(original, f"D{row}", f"D{source_row}")
    for row in range(4, 7):
        book["追加人的控除"][f"B{row}"] = f'=N({ref(HOME, f"D{row+15}")})'
    for row, label in enumerate(("寡婦", "ひとり親（母）", "ひとり親（父）", "勤労学生"), 7):
        book["追加人的控除"][f"B{row}"] = f'=IF({ref(HOME, "D22")}="{label}",1,0)'

    # Salary and premiums are user inputs; corresponding deductions are
    # calculated from approved year masters, not retyped.
    derived = {
        "B13": (f'=IF(AND(IFERROR(1*B11,0)=D4,ISNUMBER({ref(ADVANCED,"B15")})),'
                 f'{ref(ADVANCED,"B15")},IF(B12="","",MAX(0,'
                 'IF(B12<6600000,'
                 'IF(B12<=IF(D4=2025,1900000,2200000),'
                 # Income Tax Act / Special Measures Act 2026 NTA No.1410 note (2).
                 # 2026 salary 2,191,000..2,199,999: fixed income rather than
                 # gross minus the ordinary 740,000-yen minimum deduction.
                 'IF(AND(D4=2026,B12<2200000),'
                 'IF(B12<741000,0,IF(B12<2191000,B12-740000,'
                 'IF(B12<2193000,1451000,IF(B12<2196000,1453000,1456000)))),'
                 'MAX(0,B12-IF(D4=2025,650000,740000))),'
                 'ROUNDDOWN(B12/4000,0)*4000*'
                 'IF(B12<=3600000,0.7,0.8)-IF(B12<=3600000,80000,440000)),'
                 f'{ref(INPUT,"B34")})-'
                 f'IF(ISNUMBER({ref(ADVANCED,"B13")}),'
                 f'{ref(ADVANCED,"B13")},'
                 'IF(AND(B12>8500000,B25="あり"),'
                 'ROUNDUP((MIN(B12,10000000)-8500000)/10,0),0)))))'),
        "B17": f'=IF(AND(IFERROR(1*B11,0)=D4,ISNUMBER({ref(ADVANCED,"B16")})),{ref(ADVANCED,"B16")},IF(B12="","",{ref(ENGINE, "F24")}))',
        "B18": f'=IF(AND(IFERROR(1*B11,0)=D4,ISNUMBER({ref(ADVANCED,"B17")})),{ref(ADVANCED,"B17")},IF(B12="","",{ref(ENGINE, "F25")}))',
        "B14": '=IF(D25<>"",IF(ISNUMBER(D25),D25,""),B31)',
    }
    for addr, formula in derived.items():
        home[addr] = formula
        home[addr].fill = PatternFill("solid", fgColor="EAF3EA")
        home[addr].font = Font(name="Yu Gothic", color="226044", bold=True)
        home[addr].alignment = Alignment(horizontal="right", vertical="center")
        home[addr].number_format = '#,##0'
        home[addr].protection = Protection(locked=True)
    for addr, label in (
        ("A13", "給与所得控除後の金額（自動）"),
        ("A14", "所得控除の額の合計額（適用値）"),
        ("A17", "生命保険料控除額（自動）"),
        ("A18", "地震保険料控除額（自動）"),
    ):
        home[addr] = label
        home[addr].alignment = Alignment(wrap_text=True, vertical="center")
    # Only inputs drive the gate. Result-dependent checks would create a circular reference.
    ranges = ("B12:B24", "D11:D21", "D23")
    invalid = []
    # Empty optional fields must not trip the fractional-amount gate:
    # COUNT/COUNTA rejects text, COUNTIF rejects out-of-range numbers,
    # and the MOD test now treats a blank/error as zero instead of TRUE.
    for group in ranges:
        limit = 30 if group == "D23" else 100000000
        invalid.extend((f'COUNTA({group})<>COUNT({group})',
                        f'COUNTIF({group},"<0")+COUNTIF({group},">{limit}")>0',
                        f'SUMPRODUCT(--(IFERROR(MOD({group},1),0)<>0))>0'))
    invalid += [
        f'AND(N({ref(ADVANCED,"B5")})>0,{ref(ADVANCED,"B6")}="")',
        f'OR(N({ref(ADVANCED,"B9")})>N({ref(ADVANCED,"B8")}),N({ref(ADVANCED,"B11")})>N({ref(ADVANCED,"B10")}))',
        f'AND(N({ref(ADVANCED,"B24")})>0,{ref(ADVANCED,"B25")}="")',
        f'AND(ISNUMBER({ref(ADVANCED,"B36")}),N({ref(ADVANCED,"B36")})<N({ref(ADVANCED,"B24")}))',
        'AND(N(B34)>0,OR(NOT(ISNUMBER(B33)),NOT(ISNUMBER(B35)),B35<2022,B35>D4))',
        'AND(N(B34)>0,OR(NOT(ISNUMBER(B36)),B36<>1))',
        'AND(N(B34)>0,ISNUMBER(B33),B33>B34)',
        'AND(ISNUMBER(B33),B33<0)', 'AND(ISNUMBER(B34),B34<0)',
        # Source reference totals include omitted special and family deductions.
        # They are authoritative when extracted from the withholding form.
        'AND(D25<>"",OR(NOT(ISNUMBER(D25)),D25<0,D25>100000000,D25<>INT(D25)))',
        # Source total is provenance only. A manual adjustment of current-year
        # social insurance must not be rejected against historic slip totals.
        'MAX(D11:D13,D19:D21)>30', 'COUNT(D17:D18)>1', 'B13>B12', 'B15>B12', 'B16>B14',
                # Special-relative deductions (>58/62万円 income) are NOT
                # statutory dependents for the under-23 salary adjustment.
                # Only individually confirmed regular special dependents
                # or the separately declared under-16 count force B25=あり.
                f'AND(B25="なし",OR(COUNTIF({ref(RELATIVES,"G4:G33")},'
                '"特定扶養親族")>0,N(D23)>0))',
                f'OR(AND(NOT(ISNUMBER({ref(ADVANCED,"B16")})),B17<>{ref(ENGINE,"F24")}),'
                f'AND(NOT(ISNUMBER({ref(ADVANCED,"B17")})),B18<>{ref(ENGINE,"F25")}))',
                'AND(D25="",B14<>B31)']
    # The resident income-levy exemption uses statutory dependents,
    # not every numeric entry in the special-relative/spouse income fields.
    # Special-relative allowance recipients above the dependent threshold
    # do not count; an ineligible spouse does not count either.
    spouse_threshold = f'IF({ref("設定・税率","B4")}=2025,580000,620000)'
    eligible_family_count = (
        '(SUM(D11:D13,D23)+'
        f'COUNTIF({ref(RELATIVES,"G4:G33")},"特定扶養親族")+'
        + '+'.join(
            f'IF(AND(ISNUMBER({cell}),{cell}<={spouse_threshold}),1,0)'
            for cell in ("D17", "D18")
        ) + ')'
    )
    # Kyoto City's statutory individual resident income-levy exemption is
    # based on TOTAL ordinary-and-split income (総所得金額等), not merely
    # salary income from B13. B30 already includes net pension, business,
    # miscellaneous and salary/pension adjustment; declared split income
    # must additionally be included. Prefer the source gross split amount
    # B36 when available, to avoid understating an exemption threshold
    # basis if tax deductions were applied to B24.
    income_levy_basis = (
        f'(N({ref(ADVANCED,"B30")})+'
        f'IF(N({ref(ADVANCED,"B24")})>0,'
        f'MAX(N({ref(ADVANCED,"B24")}),N({ref(ADVANCED,"B36")})),0))'
    )
    unsupported = (
        'OR('
        +f'AND(N({ref(ADVANCED,"B24")})>0,NOT(OR('
        +f'{ref(ADVANCED,"B25")}="上場株式",'
        +f'{ref(ADVANCED,"B25")}="土地建物長期",'
        +f'{ref(ADVANCED,"B25")}="土地建物短期",'
        +f'{ref(ADVANCED,"B25")}="先物"))),'
        +f'AND(N({ref(ADVANCED,"B24")})>0,{ref(ADVANCED,"B33")}<>"なし"),'
        +f'N({ref(ADVANCED,"B21")})>0,'
        +f'{ref(ADVANCED,"B20")}="REQUIRES_REVIEW",'
        +f'AND({ref(ADVANCED,"B40")}<>"",{ref(ADVANCED,"B20")}<>"VERIFIED_AFTER_CORRECTION"),'
        +f'AND(D24="確定申告",B15=0,B34="",N({ref(ADVANCED,"B24")})=0),'
        f'{income_levy_basis}<=IF({eligible_family_count}=0,450000,'
        f'350000*(1+{eligible_family_count})+420000),'
        f'AND(OR(SUM(D19:D21)>0,D22<>"該当なし"),'
        f'{income_levy_basis}<=1350000))'
    )
    # Add declared split-tax resident levy to the existing levy base. Do
    # not mix split taxable income into the ordinary taxable bracket.
    basic_levy = resident["B15"].value
    if not basic_levy.endswith("))"):
        raise ValueError("Unexpected resident-income levy formula")
    resident["B15"] = basic_levy[:-1] + f'+N({ref(ADVANCED,"B27")}))'
    # The statutory donation income ceiling includes declared split gains.
    max_donation = resident["B25"].value
    gross_factor = ref(ENGINE, "D15") + "*"
    if max_donation.count(gross_factor) != 1:
        raise ValueError("Unexpected resident donation ceiling formula")
    resident["B25"] = max_donation.replace(
        gross_factor, f'({ref(ENGINE,"D15")}+N({ref(ADVANCED,"B24")}))*')
    # No ordinary taxable income: use the corresponding split 15% or 30%
    # special ratio; mixed taxable income keeps the ordinary bracket.
    general_rate = resident["B21"].value
    resident["B21"] = (
        f'=IF(AND(N({ref(ADVANCED,"B24")})>0,B20<=0),'
        f'{ref(ADVANCED,"B34")},{general_rate[1:]})'
    )
    # For a declared split-tax case, evaluate the *actual tax difference*
    # at each candidate donation amount. A fixed income-tax percentage fails
    # when the donation deduction first exhausts ordinary taxable income and
    # then reduces separately taxed stock/real-estate/futures income.
    # B24 is already split-tax taxable income AFTER all non-donation deductions.
    # Only the incremental *donation* deduction is allocated here.
    split.sheet_view.showGridLines = False
    split["A1"] = "申告分離課税・寄附金控除の配分検算（自動／編集不可）"
    fields = {
        "B2": ("総合課税の所得税課税所得（円・按分前）",
               f'=MAX(0,N({ref(ENGINE,"D15")})-N({ref(HOME,"B14")}))'),
        "B3": ("分離課税の所得税課税所得（円・按分前）",
               f'=MAX(0,N({ref(ADVANCED,"B24")}))'),
        "B4": ("寄附金控除前の総合課税所得税額",
               f'={income_tax_progressive("B2")}'),
        "B5": ("寄附金控除前の分離課税所得税額",
               f'=ROUNDDOWN(ROUNDDOWN(B3,-3)*N({ref(ADVANCED,"B34")}),0)'),
        "B6": ("控除前所得税合計", "=B4+B5"),
        "B7": ("寄附金の所得上限判定基礎（円）",
               f'=MAX(0,N({ref(ENGINE,"D15")}))'
               f'+MAX(0,IF(ISNUMBER({ref(ADVANCED,"B36")}),'
               f'{ref(ADVANCED,"B36")},{ref(ADVANCED,"B24")}))'),
        "B8": ("所得税の寄附金控除対象寄附上限（40%）",
               "=ROUNDDOWN(MAX(0,B7)*0.4,0)"),
        "B9": ("住民税の寄附金税額控除対象寄附上限（30%）",
               "=ROUNDDOWN(MAX(0,B7)*0.3,0)"),
        "B10": ("住民税特例控除上限",
                f'={ref(RESIDENT,"B19")}'),
        "B11": ("控除対象となる住民税所得割額",
                f'={ref(RESIDENT,"B16")}'),
        "B12": ("住民税特例控除割合（率）",
                f'=MAX(0,N({ref(RESIDENT,"B22")}))'),
        "B14": ("寄附金額探索上限（千円単位）",
                "=MAX(2,ROUNDDOWN(B9/1000,0))"),
    }
    for address, (label, formula_value) in fields.items():
        split[f"A{split[address].row}"] = label
        split[address] = formula_value
    headers = ("下限(k円)", "上限(k円)", "試行(k円)", "試行寄附額",
               "所得税対象控除額", "総合課税後の課税所得",
               "分離課税後の課税所得", "寄附後の所得税",
               "所得税・復興税軽減額", "住民税控除対象額",
               "住民税基本控除", "住民税特例控除",
               "住民税控除額", "合計税負担軽減額",
               "自己負担2,000円以内", "分離課税へ配分した寄附控除")
    for index, title in enumerate(headers, 2):
        split.cell(row=18, column=index, value=title)

    def set_candidate(row, donation):
        """Fill a self-contained tax-difference calculation for a donation."""
        split[f"E{row}"] = donation
        split[f"F{row}"] = f'=MAX(0,MIN(E{row},$B$8)-2000)'
        split[f"G{row}"] = f'=MAX(0,ROUNDDOWN(MAX(0,$B$2-F{row}),-3))'
        split[f"H{row}"] = f'=MAX(0,ROUNDDOWN(MAX(0,$B$3-MAX(0,F{row}-$B$2)),-3))'
        split[f"I{row}"] = (
            f'={income_tax_progressive(f"G{row}")}+'
            f'ROUNDDOWN(H{row}*N({ref(ADVANCED,"B34")}),0)')
        split[f"J{row}"] = f'=MAX(0,($B$6-I{row})*1.021)'
        split[f"K{row}"] = f'=MAX(0,MIN(E{row},$B$9)-2000)'
        split[f"L{row}"] = f'=ROUNDDOWN(K{row}*0.1,0)'
        split[f"M{row}"] = f'=MIN($B$10,MAX(0,ROUNDDOWN(K{row}*$B$12,0)))'
        split[f"N{row}"] = f'=MIN($B$11,L{row}+M{row})'
        split[f"O{row}"] = f'=J{row}+N{row}'
        split[f"P{row}"] = f'=IF(OR(E{row}<=2000,O{row}+1>=E{row}-2000),1,0)'
        split[f"Q{row}"] = f'=MAX(0,F{row}-$B$2)'

    # Bisection is monotone in the user-pay amount, at ¥1,000 increments.
    # 24 iterations cover all allowed amounts even when separate gains are huge.
    for n in range(19, 43):
        if n == 19:
            split[f"B{n}"] = "=2"
            split[f"C{n}"] = "=$B$14"
        else:
            split[f"B{n}"] = f'=IF(P{n-1}=1,D{n-1},B{n-1})'
            split[f"C{n}"] = f'=IF(P{n-1}=1,C{n-1},MAX(B{n-1},D{n-1}-1))'
        split[f"D{n}"] = f'=ROUNDUP((B{n}+C{n})/2,0)'
        set_candidate(n, f'=D{n}*1000')
    split["B43"] = '=IF(P42=1,D42,B42)'
    split["A46"] = "計算済み寄附限度額（円）"
    split["B46"] = '=IF(OR($B$9<2000,$B$10<=0),0,MAX(0,B43*1000))'
    split["A50"] = "単一寄附額（実機回帰用・参照）"
    # Demonstration probe remains synthetic. It is never used in the result.
    set_candidate(50, "=200000")
    split["A51"] = "実税額軽減額の計算は、総合課税から先に所得控除し、超過分を分離課税に適用します。"
    split.freeze_panes = "E19"
    # No redundant one-stop attestation input.
    bracket_limits = "{0,1951000,3301000,6951000,9001000,18001000,40001000}"
    bracket_rates = "{0.05,0.1,0.2,0.23,0.33,0.4,0.45}"
    previous_bracket_max = "{0,1950000,3300000,6950000,9000000,18000000,40000000}"
    taxable = ref(ENGINE, "J12")
    rate = ref(RESIDENT, "B21")
    settings_b8 = ref("設定・税率", "B8")
    settings_b10 = ref("設定・税率", "B10")
    candidate = ref(RESIDENT, "B24")
    # Resident levy after housing credit must cover the donation's resident
    # tax credits. Reference the *unguarded* candidate, not home!B8,
    # to avoid B28->B8->B28 circular references.
    remaining_levy = f'N({ref(RESIDENT,"B16")})-N(B38)'
    donation_resident = (
        f'MAX(0,N({candidate})-2000)*'
        f'IF(D24="ワンストップ",1,MAX(0,1-N({rate})*1.021))'
    )
    add_separate_tax(book, home, field, bar, note, income_tax_progressive)
    # D72:D77 belong exclusively to the split-tax reviewed model.  If any
    # separate-case credit remains populated in ordinary salary mode, the
    # ordinary donation estimate does NOT account for it and must not show.
    # Compare raw cells (not N()), so pasted text and negative entries also
    # fail closed rather than silently being interpreted as zero.
    unhandled_ordinary_credits = 'OR(' + ','.join(f'D{row}<>0' for row in range(72, 78)) + ')'
    projection = 'AND(IFERROR(1*B11,0)=2025,D4=2026)'
    same_source_year = 'IFERROR(1*B11,0)=D4'
    projected_source_mortgage = f'OR(N({ref(ADVANCED,"B43")})>0,N({ref(ADVANCED,"B44")})>0)'
    status = [
        ('B44<>"給与・通常"', "詳細設定の55行目以降で状態と試算額を確認してください。"),
        (unhandled_ordinary_credits,
         "SAFE-TAX-026 要確認。詳細設定の税額控除は通常計算に反映されません。入力内容を個別に照合してください。"),
        ('AND(ISNUMBER(B33),B33>0,OR(NOT(ISNUMBER(B34)),B34<B33))',
         "SAFE-TAX-027 要確認。住宅ローン控除の所得税適用額があるため、控除可能額（G36）を確認してください。"),
        ('AND(N(B34)>0,' + housing_2022_unknown + ')',
         "SAFE-TAX-028 要確認。2022年入居の住宅ローン控除は取得・契約条件を照合し、5%／7%の適用区分を選択してください。"),
        ('AND(D35<>"",D35<>"未確認",OR(B35<>2022,N(B34)<=0))',
         "SAFE-TAX-029 要確認。2022年以外の住宅ローン控除に2022年入居の特例区分が残っています。"),
        (f'OR({ref(ADVANCED,"B24")}<>"",{ref(ADVANCED,"B36")}<>"")',
         "SAFE-TAX-016 要確認。旧・控除後の分離課税入力です。詳細設定で控除前の所得と税目別控除を入力し、再計算してください。"),
        (f'OR(IFERROR(1*B4,0)<>D4,NOT(OR({same_source_year},{projection})))',
         "警告：原票の年分と試算年を確認してください。前年原票からの試算は2025→2026のみ対応します"),
        (f'AND({projection},OR(AND(B7<>"確認済",B7<>"住宅控除なし"),'
         f'{ref(ADVANCED,"B20")}<>"VERIFIED_AFTER_CORRECTION",'
         f'{ref(ADVANCED,"B41")}="",'
         f'{ref(ADVANCED,"B41")}<>{ref(ADVANCED,"B42")}))',
         "SAFE-TAX-030 前年票による翌年試算です。当年の給与・保険料・扶養等を確認し、読取内容の確認を行ってください"),
        (f'AND({projection},{projected_source_mortgage},'
         'OR(AND(B7="確認済",N(B34)<=0),'
         'AND(B7="住宅控除なし",OR(B33>0,N(B34)>0))))',
         "SAFE-TAX-031 前年の住宅ローン控除を流用できません。当年の適用額・可能額・入居年を確認してください"),
        ('OR(COUNT(B12:B18)<>7,AND(B25<>"あり",B25<>"なし"),'
         'AND(D24<>"ワンストップ",D24<>"確定申告"),'
         'AND(D22<>"該当なし",D22<>"寡婦",D22<>"ひとり親（母）",D22<>"ひとり親（父）",D22<>"勤労学生"))',
         "警告：源泉徴収票の金額と確認欄を入力してください"),
        ("OR(" + ",".join(invalid) + ")", "エラー：金額・人数・控除の内訳を源泉徴収票と照合してください"),
        (f'OR(ABS({ref(INPUT,"B34")}-B13-'
         f'IF(AND({same_source_year},ISNUMBER({ref(ADVANCED,"B13")})),'
         f'{ref(ADVANCED,"B13")},'
         'IF(AND(B12>8500000,B25="あり"),'
         'ROUNDUP((MIN(B12,10000000)-8500000)/10,0),0)))>10000,'
         f'{ref(RESIDENT,"B16")}<=0)',
         "警告：給与所得または住民税所得割を個別に照合してください"),
        (f'AND(N({ref(ADVANCED,"B24")})>0,'
         f'NOT(OR({ref(ADVANCED,"B25")}="上場株式",'
         f'{ref(ADVANCED,"B25")}="土地建物長期",'
         f'{ref(ADVANCED,"B25")}="土地建物短期",'
         f'{ref(ADVANCED,"B25")}="先物")))',
         "警告：申告分離課税の所得区分を選択してください"),
        (f'AND(N({ref(ADVANCED,"B24")})>0,{ref(ADVANCED,"B33")}<>"なし")',
         "警告：特例・繰越損失を伴う分離課税は個別照合が必要です"),
        (f'N({ref(ADVANCED,"B38")})>30',
         "警告：特定親族が30人を超えています。個別確認可能人数を超えるため試算を停止します"),
        (f'COUNTIF({ref(RELATIVES,"G4:G33")},"要確認")>0',
         "警告：特定扶養親族・特定親族特別控除の年齢・所得・適用要件を個別確認してください"),
        (f'AND({same_source_year},ISNUMBER({ref(ADVANCED,"B14")}),ISNUMBER(B31),'
         f'ABS({ref(ADVANCED,"B14")}-B31)>1,'
         f'OR({ref(ADVANCED,"B20")}<>"VERIFIED_AFTER_CORRECTION",'
         f'{ref(ADVANCED,"B41")}="",'
         f'{ref(ADVANCED,"B41")}<>{ref(ADVANCED,"B42")}))',
         "警告：原票の所得控除合計と自動再計算額が異なります。原票と修正額を確認して読取内容の確認を行ってください"),
        (f'AND({ref(ADVANCED,"B20")}="VERIFIED_AFTER_CORRECTION",'
         f'OR({ref(ADVANCED,"B41")}="",'
         f'{ref(ADVANCED,"B41")}<>{ref(ADVANCED,"B42")}))',
         "警告：前回の原票確認後に入力値が変わりました。読取内容を再確認してください"),
        (f'{ref(ADVANCED,"B20")}="REQUIRES_REVIEW"',
         "警告：源泉徴収票の読取内容を確認してください"),
        (unsupported, "警告：入力内容から個別照合が必要と判定しました"),
        (f'AND(N({ref(ADVANCED,"B24")})>0,N(B34)>0)',
         "警告：分離課税と住宅ローン控除の併用は税額控除の再配分検証が必要です"),
        (f'AND(N(B34)>0,ISNUMBER(B38),B38>0,{remaining_levy}<{donation_resident})',
         "警告：住宅ローン控除後の住民税枠が不足するため、寄附限度額を個別に照合してください"),
        (f'OR(COUNTIF({ref("整合性チェック","B4:B12")},"OK")<>9,{ref("自動回帰テスト","B49")}<>"PASS")',
         "エラー：税制マスタまたは内蔵検証に異常があります"),
        (f'OR(NOT(ISNUMBER({ref(RESIDENT,"B24")})),NOT(ISNUMBER({ref(RESIDENT,"B25")})))',
         "エラー：住民税または寄附額を算定できません"),
        (f'AND(D24="確定申告",N({ref(ADVANCED,"B24")})=0,OR({taxable}<=0,'
         f'ABS({ref(RESIDENT,"B20")}-{taxable})>{settings_b10},'
         f'{rate}<>LOOKUP({taxable},{bracket_limits},{bracket_rates}),'
         f'MAX(0,{candidate}-{settings_b8})>{taxable}-LOOKUP({taxable},{bracket_limits},{previous_bracket_max})))',
         "警告：確定申告による所得税の軽減額を個別に確認してください"),
    ]
    formula = '"正常"'
    for condition, message in reversed(status):
        formula = f'IF({condition},"{message}",{formula})'
    home["B28"] = f'=IFERROR({formula},"エラー：入力または計算式を確認してください")'
    home.row_dimensions[28].hidden = True
    checks = book["自動回帰テスト"]
    checks["B49"] = '=IF(COUNTIF(H4:H45,"PASS")+COUNTIF(D58:D63,"PASS")+COUNTIF(H66:H69,"PASS")=52,"PASS","FAIL")'
    prior = resident["B26"].value[1:]
    resident["B26"] = (f'=IFERROR(IF({ref(HOME,"B28")}="正常",'
                       f'IF(N({ref(ADVANCED,"B24")})>0,{ref(SPLIT_ALLOC,"B46")},'
                       f'{prior}),""),"")')
    bar(detail, 1, "ふるさと納税｜計算根拠")
    note(detail, 2, "=" + ref(HOME, "B28"))
    note(detail, 3, f'="所得年 "&{ref(HOME,"D4")}&" ｜ 住民税課税年度 "&{ref(HOME,"D5")}&" ｜ 税制版 "&{ref(HOME,"B29")}')
    items = (
        ("総合課税所得（給与・年金等）", ref(ENGINE, "D15"), "給与所得＋追加の総合課税所得"),
        ("所得控除（住民税）", f'{ref(HOME,"B14")}-{ref(ENGINE,"J43")}', "所得税の所得控除合計 − 控除差額"),
        ("住民税課税所得", ref(RESIDENT, "B6"), "総合所得−住民税所得控除。千円未満切捨て"),
        ("住民税算出所得割", ref(RESIDENT, "B15"), "総合課税所得割＋申告分離課税所得割"),
        ("調整控除", ref(RESIDENT, "B14"), "課税所得と人的控除差から算定"),
        ("調整控除後の所得割", ref(RESIDENT, "B16"), "当年の総合所得・申告分離課税から推計"),
        ("ふるさと納税特例控除上限", ref(RESIDENT, "B19"), "調整控除後の所得割 × 特例控除限度割合"),
        ("特例割合判定の所得税率", ref(RESIDENT, "B21"), "住民税課税所得から人的控除差等を控除して判定"),
        ("総合課税のみの簡易目安（参考）", ref(RESIDENT, "B23"), "申告分離課税がある場合は下段の再計算値を採用"),
        ("最終の寄附目安額", ref(RESIDENT, "B26"), "千円単位で保守的に丸め、所得に対する限度も適用"),
    )
    for row, (label, calculation, explanation) in enumerate(items, 5):
        detail[f"A{row}"] = label
        detail[f"B{row}"] = f'=IF({ref(HOME,"B28")}="正常",{calculation},"")'
        detail[f"B{row}"].number_format = "0.0%" if row == 12 else '#,##0'
        detail[f"B{row}"].alignment = Alignment(horizontal="right", vertical="center")
        detail.merge_cells(start_row=row, start_column=3, end_row=row, end_column=4)
        detail[f"C{row}"] = explanation
        detail[f"C{row}"].alignment = Alignment(wrap_text=True, vertical="center", indent=1)
        detail.row_dimensions[row].height = 28
    note(detail, 15, "申告分離課税では所得税の実際の減税額・住民税を寄附額ごとに再計算し、自己負担2,000円以内の最大額を探索します。")
    detail["A16"] = "分離課税（課税所得）"
    detail["B16"] = f'=IF(AND({ref(HOME,"B28")}="正常",N({ref(ADVANCED,"B24")})>0),{ref(SPLIT_ALLOC,"B3")},"")'
    detail["C16"] = "総合課税の税率だけでは分離課税部分の減税額を算定できません。"
    detail["A17"] = "寄附金控除前：総合課税の課税所得"
    detail["B17"] = f'=IF(AND({ref(HOME,"B28")}="正常",N({ref(ADVANCED,"B24")})>0),{ref(SPLIT_ALLOC,"B2")},"")'
    detail["C17"] = "所得控除を差し引いた後。寄附金控除は総合課税から先に適用。"
    detail["A18"] = "最終寄附目安で分離課税に配分した控除"
    detail["B18"] = f'=IF(AND({ref(HOME,"B28")}="正常",N({ref(ADVANCED,"B24")})>0),MAX(0,MIN({ref(RESIDENT,"B26")},{ref(SPLIT_ALLOC,"B8")})-2000-{ref(SPLIT_ALLOC,"B2")}),"")'
    detail["C18"] = "所得税の寄附金控除のうち総合課税から引ききれない部分。"
    for row in range(16,19):
        detail[f"B{row}"].number_format = '#,##0'
        detail[f"B{row}"].alignment = Alignment(horizontal="right")
        detail.merge_cells(start_row=row,start_column=3,end_row=row,end_column=4)
        detail[f"C{row}"].alignment = Alignment(wrap_text=True, indent=1)
        detail.row_dimensions[row].height = 32
    note(detail, 19, "分離課税の新規試算は操作画面の詳細設定に表示します。")
    detail["A20"] = "所得控除合計（原票記載）"
    detail["B20"] = "=" + ref(HOME,"D31")
    detail["A21"] = "所得控除合計（自動算定）"
    detail["B21"] = "=" + ref(HOME,"B31")
    detail["A22"] = "所得控除合計（計算使用額）"
    detail["B22"] = "=" + ref(HOME,"B14")
    detail["A23"] = "所得控除額の計算状態"
    detail["B23"] = "=" + ref(HOME,"D26")
    for row in (20,21,22):
        detail[f"B{row}"].number_format = '#,##0'
    detail["B23"].font = Font(name="Yu Gothic", bold=True, color="9C4100")
    detail.print_area = "A1:D23"
    for sheet in book:
        sheet.sheet_state = "visible" if sheet in (home, relatives) else "veryHidden"
        sheet.sheet_view.tabSelected = sheet == home
    book.active = 0
    # Retain a complete first-open calculation while allowing Excel to use
    # smart dependency recalculation thereafter. This is isolated to the
    # v4.18.3 review; compare its xlPending state in a freshly owned Excel
    # process before claiming the calculation-state defect resolved.
    book.calculation = CalcProperties(calcMode="auto", fullCalcOnLoad=True, forceFullCalc=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    book.save(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", type=Path, default=ROOT / "workbook/baseline.xlsx")
    args = parser.parse_args()
    build(args.source, args.output)
