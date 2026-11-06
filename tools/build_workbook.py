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

ROOT = Path(__file__).resolve().parents[1]
HOME = "操作画面"
ENGINE = "ふるさと納税限度額計算"
INPUT = "源泉徴収票入力"
RESIDENT = "住民税再計算"
DETAIL = "計算根拠"
ADVANCED = "例外・分離課税"


def ref(sheet, address):
    return f"'{sheet}'!{address}"


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
    detail = book.create_sheet(DETAIL)
    extra = book.create_sheet(ADVANCED)
    extra.sheet_view.showGridLines = False
    extra.column_dimensions["A"].width = 38
    extra.column_dimensions["B"].width = 23
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

    bar(home, 1, "ふるさと納税 寄附限度額試算    1.0 開発版")
    bar(extra, 1, "特例案件：分離課税・住宅ローン控除（検証入力）")
    extra.merge_cells("A3:D3")
    extra["A3"] = "追加入力は既存計算エンジンと分離。未検証案件の寄附限度額は表示しません。"
    extra["A3"].alignment = Alignment(wrap_text=True)
    extra.row_dimensions[3].height = 35
    extra_items = (
        (4, "案件区分", "通常", ("通常", "住宅ローン控除", "分離課税", "両方")),
        (5, "住宅ローン控除額（所得税・源泉票）", None, None),
        (6, "住宅ローン控除額（住民税適用実額）", None, None),
        (7, "分離課税の課税所得", None, None),
        (8, "分離所得の種類", None, ("なし", "上場株式", "土地建物長期", "土地建物短期", "先物", "その他")),
        (9, "分離課税の住民税所得割額（資料値）", None, None),
        (10, "住民税所得割額（調整控除後・通知書）", None, None),
        (11, "所得税率（確定申告書・検証値）", None, None),
        (12, "その他の税額控除（所得税・住民税）", None, None),
        (13, "所得金額調整控除額（原票）", None, None),
        (14, "源泉票：所得控除合計額（照合のみ）", None, None),
        (15, "源泉票：給与所得控除後の額（照合）", None, None),
        (16, "源泉票：生命保険料控除額（照合）", None, None),
        (17, "源泉票：地震保険料控除額（照合）", None, None),
        (18, "源泉票：源泉徴収税額（照合）", None, None),
        (19, "読取ファイルの方式", None, None),
        (20, "取込時の照合状態", None, None),
        (21, "旧長期損害保険料（支払額）", None, None),
    )
    for row, label, initial, choices in extra_items:
        extra[f"A{row}"] = label
        extra[f"A{row}"].alignment = Alignment(wrap_text=True, vertical="center")
        extra[f"B{row}"] = initial
        extra.row_dimensions[row].height = 27
        if row not in (19, 20):
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
    extra.merge_cells("A23:D23")
    extra["A23"] = "住宅ローン控除・分離課税などは適用順序や住民税通知値が必要です。未検証の自動計算は停止します。"
    extra["A23"].alignment = Alignment(wrap_text=True)
    extra.row_dimensions[23].height = 40
    home.row_dimensions[3].height = 28
    field("B4", "選択する所得年", "2026", ("2025", "2026"))
    home["C4"], home["D4"] = "適用中の所得年", "=" + ref("設定・税率", "B4")
    home["C5"], home["D5"] = "住民税課税年度", "=" + ref(RESIDENT, "B5")
    note(home, 6, '="税制版 "&B29&" ｜ "&B30')
    home["B29"] = "2026-11-05-bundled"
    home["B30"] = "内蔵マスタ"
    home.row_dimensions[29].hidden = True
    home.row_dimensions[30].hidden = True
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
    field("B11", "源泉徴収票の所得年", choices=("2025", "2026"))
    labels = [
        "支払金額", "給与所得控除後の金額（調整控除後）", "所得控除の額の合計額", "源泉徴収税額",
        "社会保険料等の金額（総額）", "生命保険料の控除額", "地震保険料の控除額",
    ]
    for row, label in enumerate(labels, 12):
        field(f"B{row}", label)
    for row, label in enumerate(("新生命保険料", "旧生命保険料", "新個人年金保険料", "旧個人年金保険料",
                                 "介護医療保険料", "地震保険料の支払額"), 19):
        field(f"B{row}", label)
    field("B25", "23歳未満の扶養親族", choices=("あり", "なし"))
    field("B26", "対象外条件の確認", choices=("該当なし", "該当あり"))
    for row, label in enumerate(("一般扶養（人数）", "同居老親（人数）", "その他の老人扶養（人数）"), 11):
        field(f"D{row}", label, maximum=30)
    for row, label in enumerate(("特定親族1の合計所得", "特定親族2の合計所得", "特定親族3の合計所得",
                                 "配偶者の合計所得（70歳未満）", "配偶者の合計所得（70歳以上）"), 14):
        field(f"D{row}", label)
    for row, label in enumerate(("普通障害（人数）", "特別障害（人数）", "同居特別障害（人数）"), 19):
        field(f"D{row}", label, maximum=30)
    field("D22", "本人の控除区分", choices=("該当なし", "寡婦", "ひとり親（母）", "ひとり親（父）", "勤労学生"))
    field("D23", "16歳未満の扶養（人数）", maximum=30)
    field("D24", "申告方式", choices=("ワンストップ", "確定申告"))
    home["D24"] = "確定申告"
    note(home, 27, "対象外条件は年末調整未済、準確定申告、非居住者、給与以外の所得、住宅ローン・配当等の税額控除、医療費・他の寄附、旧長期損害保険、自治体独自の税率などです。")
    home.row_dimensions[27].height = 42
    note(home, 31, "水色欄に支払金額・保険料を入力。自動計算欄は緑色。特例案件は専用フォームで入力します。")
    home.print_area = "A1:D31"

    def link(sheet, dest, src):
        target = ref(HOME, src)
        sheet[dest] = f'=IF({target}="","",{target})'

    for row in range(7, 11):
        link(withholding, f"B{row}", f"B{row + 5}")
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
        "B13": ('=IF(B12="","",MAX(0,'
                 'IF(B12<6600000,'
                 'IF(B12<=IF(D4=2025,1900000,2200000),'
                 'MAX(0,B12-IF(D4=2025,650000,740000)),'
                 'ROUNDDOWN(B12/4000,0)*4000*'
                 'IF(B12<=3600000,0.7,0.8)-IF(B12<=3600000,80000,440000)),'
                 f'{ref(INPUT,"B34")})-'
                 f'IF(ISNUMBER({ref(ADVANCED,"B13")}),'
                 f'{ref(ADVANCED,"B13")},'
                 'IF(AND(B12>8500000,B25="あり"),'
                 '(MIN(B12,10000000)-8500000)*0.1,0))))'),
        "B17": f'=IF(B12="","",{ref(ENGINE, "F24")})',
        "B18": f'=IF(B12="","",{ref(ENGINE, "F25")})',
        "B14": (f'=IF(OR(B13="",B16=""),"",'
                f'SUM(B16:B18,{ref(ENGINE,"F15")},'
                f'{ref(ENGINE,"F38")},{ref("追加人的控除","C12")}))'),
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
        ("A14", "所得控除の額の合計額（自動）"),
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
        f'AND(ISNUMBER({ref(ADVANCED,"B14")}),ABS(B14-{ref(ADVANCED,"B14")})>1)',
        f'AND(ISNUMBER({ref(ADVANCED,"B15")}),ABS(B13-{ref(ADVANCED,"B15")})>1)',
        f'AND(ISNUMBER({ref(ADVANCED,"B16")}),ABS(B17-{ref(ADVANCED,"B16")})>1)',
        f'AND(ISNUMBER({ref(ADVANCED,"B17")}),ABS(B18-{ref(ADVANCED,"B17")})>1)',
        'MAX(D11:D13,D19:D21)>30', 'COUNT(D17:D18)>1', 'B13>B12', 'B15>B12', 'B16>B14',
                'AND(COUNT(D14:D16,D23)>0,B25="なし",OR(COUNT(D14:D16)>0,D23>0))',
                f'OR(B17<>{ref(ENGINE,"F24")},B18<>{ref(ENGINE,"F25")})',
                f'B14<>SUM(B16:B18,{ref(ENGINE,"F15")},{ref(ENGINE,"F38")},{ref("追加人的控除","C12")})']
    unsupported = (
        'OR(B26="該当あり",'
        +f'{ref(ADVANCED,"B4")}<>"通常",'
        +f'N({ref(ADVANCED,"B5")})>0,N({ref(ADVANCED,"B6")})>0,'
        +f'N({ref(ADVANCED,"B7")})>0,N({ref(ADVANCED,"B9")})>0,'
        +f'N({ref(ADVANCED,"B10")})>0,N({ref(ADVANCED,"B12")})>0,'
        +f'N({ref(ADVANCED,"B21")})>0,'
        +'AND(D24="確定申告",B15=0),'
        'B13<=IF(SUM(D11:D13,D23)+COUNT(D14:D18)=0,450000,'
        '350000*(1+SUM(D11:D13,D23)+COUNT(D14:D18))+420000),'
        'AND(OR(SUM(D19:D21)>0,D22<>"該当なし"),B13<=1350000))'
    )
    # No redundant one-stop attestation input.
    bracket_limits = "{0,1951000,3301000,6951000,9001000,18001000,40001000}"
    bracket_rates = "{0.05,0.1,0.2,0.23,0.33,0.4,0.45}"
    previous_bracket_max = "{0,1950000,3300000,6950000,9000000,18000000,40000000}"
    taxable = ref(ENGINE, "J12")
    rate = ref(RESIDENT, "B21")
    settings_b8 = ref("設定・税率", "B8")
    settings_b10 = ref("設定・税率", "B10")
    candidate = ref(RESIDENT, "B24")
    status = [
        ('OR(IFERROR(1*B4,0)<>D4,IFERROR(1*B11,0)<>D4)', "警告：源泉徴収票と適用中の所得年を一致させてください"),
        ('OR(COUNT(B12:B18)<>7,AND(B25<>"あり",B25<>"なし"),'
         'AND(B26<>"該当なし",B26<>"該当あり"),'
         'AND(D24<>"ワンストップ",D24<>"確定申告"),'
         'AND(D22<>"該当なし",D22<>"寡婦",D22<>"ひとり親（母）",D22<>"ひとり親（父）",D22<>"勤労学生"))',
         "警告：源泉徴収票の金額と確認欄を入力してください"),
        ("OR(" + ",".join(invalid) + ")", "エラー：金額・人数・控除の内訳を源泉徴収票と照合してください"),
        (f'OR(ABS({ref(INPUT,"B34")}-B13-'
         f'IF(ISNUMBER({ref(ADVANCED,"B13")}),{ref(ADVANCED,"B13")},'
         'IF(AND(B12>8500000,B25="あり"),'
         '(MIN(B12,10000000)-8500000)*0.1,0)))>10000,'
         f'{ref(RESIDENT,"B16")}<=0)',
         "警告：給与所得または住民税所得割を個別に照合してください"),
        (unsupported, "警告：対象外または追加照合が必要なため、金額の表示を停止しました"),
        (f'OR(COUNTIF({ref("整合性チェック","B4:B12")},"OK")<>9,{ref("自動回帰テスト","B49")}<>"PASS")',
         "エラー：税制マスタまたは内蔵検証に異常があります"),
        (f'OR(NOT(ISNUMBER({ref(RESIDENT,"B24")})),NOT(ISNUMBER({ref(RESIDENT,"B25")})))',
         "エラー：住民税または寄附額を算定できません"),
        (f'AND(D24="確定申告",OR({taxable}<=0,'
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
    resident["B26"] = f'=IFERROR(IF({ref(HOME,"B28")}="正常",{prior},""),"")'
    bar(detail, 1, "ふるさと納税｜計算根拠")
    note(detail, 2, "=" + ref(HOME, "B28"))
    note(detail, 3, f'="所得年 "&{ref(HOME,"D4")}&" ｜ 住民税課税年度 "&{ref(HOME,"D5")}&" ｜ 税制版 "&{ref(HOME,"B29")}')
    items = (
        ("給与所得金額", ref(ENGINE, "D15"), "源泉徴収票の調整控除後の金額"),
        ("所得控除（住民税）", f'{ref(HOME,"B14")}-{ref(ENGINE,"J43")}', "所得税の所得控除合計 − 控除差額"),
        ("住民税課税所得", ref(RESIDENT, "B6"), "給与所得 − 所得控除。千円未満切捨て"),
        ("住民税算出所得割", ref(RESIDENT, "B15"), "住民税課税所得 × 標準税率"),
        ("調整控除", ref(RESIDENT, "B14"), "課税所得と人的控除差から算定"),
        ("調整控除後の所得割", ref(RESIDENT, "B16"), "算出所得割 − 調整控除"),
        ("ふるさと納税特例控除上限", ref(RESIDENT, "B19"), "調整控除後の所得割 × 特例控除限度割合"),
        ("特例割合判定の所得税率", ref(RESIDENT, "B21"), "住民税課税所得から人的控除差等を控除して判定"),
        ("寄附限度額（丸め前）", ref(RESIDENT, "B23"), "2,000円 ＋ 特例上限 ÷（90% − 所得税率 × 1.021）"),
        ("最終の寄附目安額", ref(RESIDENT, "B26"), "千円単位で保守的に丸め、所得に対する限度も適用"),
    )
    for row, (label, calculation, explanation) in enumerate(items, 5):
        detail[f"A{row}"] = label
        detail[f"B{row}"] = f'=IF({ref(HOME,"B28")}="正常",{calculation},"")'
        detail[f"B{row}"].number_format = "0.0%" if row == 12 else '#,##0'
        detail[f"B{row}"].alignment = Alignment(horizontal="right", vertical="center")
        detail.merge_cells(start_row=row, start_column=3, end_row=row, end_column=4)
        detail[f"C{row}"] = explanation
        detail[f"C{row}"].alignment = Alignment(wrap_text=True, vertical="center")
        detail.row_dimensions[row].height = 28
    note(detail, 15, "特例控除が上限に達しない寄附額の試算です。均等割・森林環境税は含めません。")
    detail.print_area = "A1:D15"
    for sheet in book:
        sheet.sheet_state = "visible" if sheet == home else "veryHidden"
        sheet.sheet_view.tabSelected = sheet == home
    book.active = 0
    book.calculation = CalcProperties(calcMode="auto", fullCalcOnLoad=True, forceFullCalc=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    book.save(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", type=Path, default=ROOT / "workbook/baseline.xlsx")
    args = parser.parse_args()
    build(args.source, args.output)
