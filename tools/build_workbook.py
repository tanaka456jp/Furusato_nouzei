"""Build the review workbook from the unmodified v3 template."""
import argparse
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.workbook.properties import CalcProperties
from openpyxl.styles import Alignment, Font, PatternFill, Protection
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[1]
HOME = "操作画面"
ENGINE = "ふるさと納税限度額計算"
INPUT = "源泉徴収票入力"
RESIDENT = "住民税再計算"
DETAIL = "計算根拠"


def ref(sheet, address):
    return f"'{sheet}'!{address}"


def build(source, output):
    book = load_workbook(source)
    del book[HOME]
    home = book.create_sheet(HOME, 0)
    detail = book.create_sheet(DETAIL)
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
    note(home, 27, "対象外条件は年末調整未済、準確定申告、非居住者、給与以外の所得、住宅ローン・配当等の税額控除、医療費・他の寄附、旧長期損害保険、自治体独自の税率などです。")
    home.row_dimensions[27].height = 42
    note(home, 31, "票の必須金額は記載なしなら0を入力。控除の内訳は該当分のみ入力し、親族の合計所得が0円なら0と入力します。")
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

    # Only inputs drive the gate. Result-dependent checks would create a circular reference.
    ranges = ("B12:B24", "D11:D21", "D23")
    invalid = []
    for group in ranges:
        limit = 30 if group == "D23" else 100000000
        invalid.extend((f'COUNTA({group})<>COUNT({group})',
                        f'COUNTIF({group},"<0")+COUNTIF({group},">{limit}")>0',
                        f'SUMPRODUCT(--IFERROR(MOD({group},1)<>0,TRUE))>0'))
    invalid += ['MAX(D11:D13,D19:D21)>30', 'COUNT(D17:D18)>1', 'B13>B12', 'B15>B12', 'B16>B14',
                'AND(COUNT(D14:D16,D23)>0,B25="なし",OR(COUNT(D14:D16)>0,D23>0))',
                f'OR(B17<>{ref(ENGINE,"F24")},B18<>{ref(ENGINE,"F25")})',
                f'B14<>SUM(B16:B18,{ref(ENGINE,"F15")},{ref(ENGINE,"F38")},{ref("追加人的控除","C12")})']
    unsupported = (
        'OR(B26="該当あり",AND(D24="確定申告",B15=0),'
        'AND(D24="ワンストップ",D25<>"確認済"),'
        'B13<=IF(SUM(D11:D13,D23)+COUNT(D14:D18)=0,450000,'
        '350000*(1+SUM(D11:D13,D23)+COUNT(D14:D18))+420000),'
        'AND(OR(SUM(D19:D21)>0,D22<>"該当なし"),B13<=1350000))'
    )
    field("D25", "ワンストップ要件", choices=("確認済",))
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
        (f'OR(ABS({ref(INPUT,"B34")}-B13)>10000,{ref(RESIDENT,"B16")}<=0)',
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
