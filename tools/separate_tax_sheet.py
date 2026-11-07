"""Generate independent Excel formulas for the reviewed split-income scenario."""
import json
from pathlib import Path

from openpyxl.styles import Alignment, Font, PatternFill, Protection
from openpyxl.utils import get_column_letter

SPEC = json.loads((Path(__file__).resolve().parents[1] / "taxdata/separate-tax-v1.json").read_text(encoding="utf-8"))
MODEL = "分離課税詳細計算"
FIRST = 16
CANDIDATE = 27
GRID_FIRST = 28


def add_separate_tax(book, home, field, bar, note, progressive):
    """Leave salary inputs in place and add a separate, explicitly enabled case."""
    model = book.create_sheet(MODEL)
    buckets = SPEC["buckets"]
    bar(home, 42, "詳細設定 | 申告分離課税（検証版）")
    note(home, 43, "所得控除前・経費差引後の所得を入力します。源泉分離・申告不要・NISAは加えません。金額は円、該当なしは0です。")
    field("B44", "計算する案件", "給与・通常", ("給与・通常", "申告分離"))
    field("D44", "申告方式", "確定申告", ("確定申告", "ワンストップ"))
    for row, bucket in enumerate(buckets, 45):
        field(f"B{row}", bucket[1])
    field("D45", "所得税の所得控除合計")
    field("D46", "住民税の所得控除合計")
    field("D47", "法定人的控除差の合計")
    field("D48", "検算する寄附額")
    field("D49", "適用条件", "未確認", ("未確認", "照合済", "特例あり"))
    field("D50", "分離課税の所得年", 2026, maximum=2026)
    note(home, 52, "標準税率の普通市町村（市町村6%・道府県4%）を前提とします。非課税・調整措置、特別控除、損失、税額控除、源泉税の精算、他の寄附がある案件は「特例あり」を選択。")
    note(home, 53, "基礎控除を含む所得控除合計を税目別に入力。法定人的控除差は基礎控除5万円を含み、国税と住民税の控除合計の差とは別です。")
    note(home, 54, "入力はブックに保存できます。修正後は自動再計算（手動時はF9）。控除配分・年税額・寄附負担を再計算します。")
    home["A55"] = "詳細設定の状態"
    home["B55"] = f"='{MODEL}'!B2"
    home["B55"].alignment = Alignment(wrap_text=True, vertical="center")
    home.merge_cells("B55:D55")
    home.row_dimensions[55].height = 52
    home["A56"] = "寄附目安（千円刻み）"
    home["B56"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!B12,"")'
    home["C56"] = "入力寄附の自己負担"
    home["D56"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!S{CANDIDATE},"")'
    labels = ("所得区分", "国税控除配分", "国税課税所得", "住民税課税所得")
    for col, label in enumerate(labels, 1):
        home.cell(57, col, label)
    for row, bucket in enumerate(buckets, 58):
        calc_row = FIRST + row - 58
        home.cell(row, 1, bucket[1])
        for col, calc_col in zip("BCD", "CEG"):
            home[f"{col}{row}"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!{calc_col}{calc_row},"")'
    home["A65"] = "寄附前：所得税等"
    home["B65"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!B7,"")'
    home["C65"] = "寄附前：住民税所得割"
    home["D65"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!B10,"")'
    home["A66"] = "寄附後：所得税等"
    home["B66"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!K{CANDIDATE},"")'
    home["C66"] = "寄附後：住民税所得割"
    home["D66"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!SUM_PLACEHOLDER,"")'.replace(
        f"'{MODEL}'!SUM_PLACEHOLDER", f"SUM('{MODEL}'!O{CANDIDATE}:P{CANDIDATE})")
    note(home, 67, "所得税等は源泉徴収精算前。試算対象を超える場合は、寄附目安額・税額を保留します。正式リリースHOLD。")
    for row in range(56, 67):
        home.row_dimensions[row].height = 25
        for col in "ABCD":
            cell = home[f"{col}{row}"]
            cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="right" if col != "A" else "left")
            if cell.data_type == "f":
                cell.number_format = "#,##0"
                cell.fill = PatternFill("solid", fgColor="EAF3EA")
                cell.protection = Protection(locked=True)

    home_ref = "'操作画面'!"
    model["A1"] = "申告分離課税・独立計算（合成検証版）"
    model["B3"] = f"=SUM({home_ref}B45:B51)"
    model["B4"] = f'=LOOKUP(B3,{{0,1320001,3360001,4890001,6550001}},IF({home_ref}D50=2025,{{950000,880000,680000,630000,580000}},{{1040000,1040000,1040000,670000,620000}}))'
    valid_range = f"{home_ref}B45:B51"
    deduction_range = f"{home_ref}D45:D48"
    model["B2"] = (
        f'=IFERROR(IF({home_ref}B44="給与・通常","詳細設定を使用していません",'
        f'IF({home_ref}B44<>"申告分離","SAFE-TAX-011 利用者操作が必要。案件区分を選択して再計算。",'
        f'IF({home_ref}D44<>"確定申告","SAFE-TAX-012 利用者操作が必要。確定申告を選択して再計算。",'
        f'IF({home_ref}D49<>"照合済","SAFE-TAX-013 対象外または要確認。適用条件を照合。特例ありは個別計算。",'
        f'IF(OR(AND({home_ref}D50<>2025,{home_ref}D50<>2026),COUNT({valid_range},{deduction_range})<>11,'
        f'MIN({valid_range},{deduction_range})<0,MAX({valid_range},{deduction_range})>100000000,'
        f'SUMPRODUCT(--(MOD({valid_range},1)<>0))+SUMPRODUCT(--(MOD({deduction_range},1)<>0))>0),'
        f'"SAFE-TAX-011 要確認。所得年と全金額を確認。該当なしは0。",'
        f'IF(OR(B3<1000000,B3>{SPEC["maximumIncome"]},B3={home_ref}B45,'
        f'AND({home_ref}B48>0,B3-{home_ref}B45>{home_ref}B48)),'
        f'"SAFE-TAX-014 対象外。所得額・配当と他の分離所得の併用を個別確認。",'
        f'IF(OR({home_ref}D45<B4,{home_ref}D46<430000,{home_ref}D47<50000),'
        '"SAFE-TAX-015 安全停止。基礎控除を含む税目別控除・法定人的控除差を照合。",'
        '"計算可能"))))))),"SAFE-TAX-011 要確認。入力エラーを修正して再計算。")'
    )
    model["B5"] = f'=E{FIRST}-{home_ref}D47-MAX(0,B4-480000)'
    model["B6"] = f'=IF(AND(G{FIRST}>0,G{FIRST}-{home_ref}D47-MAX(0,B4-480000)>=0),90000-1021*LOOKUP(G{FIRST}-{home_ref}D47-MAX(0,B4-480000),{{0,1950001,3300001,6950001,9000001,18000001,40000001}},{{5,10,20,23,33,40,45}}),IF(B{FIRST+1}>0,59370,74685))'
    last = FIRST + len(buckets) - 1
    model["B7"] = f'=SUM(H{FIRST}:H{last})+INT(SUM(H{FIRST}:H{last})*21/1000)'
    model["B8"] = f'=MAX(0,SUM(I{FIRST}:I{last})-B11*30)'
    model["B9"] = f'=MAX(0,SUM(J{FIRST}:J{last})-B11*20)'
    model["B10"] = '=INT(B8/100000)*100+INT(B9/100000)*100'
    model["B11"] = f'=IF(G{FIRST}<=2000000,MIN(G{FIRST},{home_ref}D47),MAX(50000,{home_ref}D47-G{FIRST}+2000000))'
    grid_last = GRID_FIRST + (SPEC["gridMaximum"] - 3000) // SPEC["gridStep"]
    model["B12"] = f'=MAX(T{GRID_FIRST}:T{grid_last})'
    model["B13"] = f'=MAX(0,{home_ref}D45-SUM(B{FIRST}:B{last}))'
    model["B14"] = f'=MAX(0,{home_ref}D46-SUM(B{FIRST}:B{last}))'
    for index, bucket in enumerate(buckets):
        row = FIRST + index
        model[f"A{row}"] = bucket[0]
        model[f"B{row}"] = f"={home_ref}B{45 + index}"
        prev = f"SUM(B{FIRST}:B{row-1})" if index else "0"
        model[f"C{row}"] = f"=MIN(B{row},MAX(0,{home_ref}D45-{prev}))"
        model[f"D{row}"] = f"=MIN(B{row},MAX(0,{home_ref}D46-{prev}))"
        model[f"E{row}"] = f"=INT((B{row}-C{row})/1000)*1000"
        model[f"G{row}"] = f"=INT((B{row}-D{row})/1000)*1000"
        model[f"H{row}"] = f"={progressive(f'E{row}')}" if index == 0 else f"=E{row}*{bucket[2]}/100"
        model[f"I{row}"] = f"=G{row}*{bucket[3] if index else 60}"
        model[f"J{row}"] = f"=G{row}*{bucket[4] if index else 40}"
    for col, label in enumerate(("寄附", "国税寄附金控除", *[b[0] for b in buckets], "所得税", "所得税等",
                                 "基本控除対象（0.1円単位）", "市控除", "県控除", "市税", "県税",
                                 "国税軽減", "住民税軽減", "自己負担", "採用額"), 1):
        model.cell(26, col, label)
    for row in range(CANDIDATE, grid_last + 1):
        model[f"A{row}"] = f"={home_ref}D48" if row == CANDIDATE else 3000 + (row - GRID_FIRST) * SPEC["gridStep"]
        model[f"B{row}"] = f"=MAX(0,MIN(A{row},INT($B$3*4/10))-2000)"
        for index, bucket in enumerate(buckets):
            src = FIRST + index
            prev = f"SUM($B${FIRST}:$B${src-1})" if index else "0"
            col = get_column_letter(3 + index)
            model[f"{col}{row}"] = f"=INT(MAX(0,$B${src}-MAX(0,{home_ref}$D$45+B{row}-{prev}))/1000)*1000"
        model[f"J{row}"] = f'={progressive(f"C{row}")}+' + "+".join(
            f"{get_column_letter(3 + i)}{row}*{bucket[2]}/100" for i, bucket in enumerate(buckets) if i)
        model[f"K{row}"] = f"=J{row}+INT(J{row}*21/1000)"
        model[f"L{row}"] = f"=MAX(0,MIN(A{row}*10,$B$3*3)-20000)"
        model[f"M{row}"] = f"=ROUNDUP((L{row}*30000+MIN($B$8*1000,MAX(0,A{row}-2000)*$B$6*30))/5000000,0)"
        model[f"N{row}"] = f"=ROUNDUP((L{row}*20000+MIN($B$9*1000,MAX(0,A{row}-2000)*$B$6*20))/5000000,0)"
        model[f"O{row}"] = f"=MAX(0,INT(($B$8-M{row}*1000)/100000))*100"
        model[f"P{row}"] = f"=MAX(0,INT(($B$9-N{row}*1000)/100000))*100"
        model[f"Q{row}"] = f"=$B$7-K{row}"
        model[f"R{row}"] = f"=$B$10-O{row}-P{row}"
        model[f"S{row}"] = f"=A{row}-Q{row}-R{row}"
        model[f"T{row}"] = f'=IF(AND($B$2="計算可能",S{row}<=2000),A{row},0)'
    return MODEL
