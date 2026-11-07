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
# At most 1100 + 7 national threshold changes and 5802 local ¥100
# changes over the search range, plus up to 977 further local changes
# from the housing credit and the initial and final candidates.
EXACT_STEPS = 8100


def add_separate_tax(book, home, field, bar, note, progressive):
    """Leave salary inputs in place and add a separate, explicitly enabled case."""
    model = book.create_sheet(MODEL)
    buckets = SPEC["buckets"]
    bar(home, 42, "詳細設定 | 申告分離課税（検証版）")
    note(home, 43, "総所得金額は給与所得控除後等の所得です。分離所得は所得控除前・経費差引後で入力。源泉分離・申告不要・NISAは加えません。金額は円、該当なしは0です。")
    field("B44", "計算する案件", "給与・通常", ("給与・通常", "申告分離"))
    field("D44", "申告方式", "確定申告", ("確定申告", "ワンストップ"))
    for row, bucket in enumerate(buckets, 45):
        field(f"B{row}", bucket[1])
    field("D45", "所得税の控除合計（寄附前）")
    field("D46", "住民税の所得控除合計")
    field("D47", "法定人的控除差の合計")
    field("D48", "検算する寄附額")
    field("D49", "適用条件", "未確認", ("未確認", "照合済", "特例あり"))
    field("D50", "分離課税の所得年", 2026, maximum=2026)
    field("D51", "住民税の課税自治体", "標準市町村", ("標準市町村", "標準指定都市", "条例差・不明"))
    note(home, 52, "住民税の課税自治体は標準市町村（6%・4%）または標準指定都市（8%・2%）。超過課税等は「条例差・不明」、非課税・損失・未対応の税額控除等は「特例あり」を選択。")
    note(home, 53, "検算対象を含む寄附金控除を除き、基礎控除を含む控除合計を税目別に入力。法定人的控除差は基礎控除5万円を含み、国税と住民税の控除合計の差とは別です。")
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
    labels = ("所得区分", "控除配分 国税／住民税", "国税課税所得", "住民税課税所得")
    for col, label in enumerate(labels, 1):
        home.cell(57, col, label)
    for row, bucket in enumerate(buckets, 58):
        calc_row = FIRST + row - 58
        home.cell(row, 1, bucket[1])
        for col, calc_col in zip("BCD", "CEG"):
            home[f"{col}{row}"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!{calc_col}{calc_row},"")'
        home[f"B{row}"] = (
            f"""=IF('{MODEL}'!B2="計算可能",TEXT('{MODEL}'!C{calc_row},"#,##0")"""
            f"""&"／"&TEXT('{MODEL}'!D{calc_row},"#,##0"),"")"""
        )

    home["A65"] = "寄附前：所得税等"
    home["B65"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!B7,"")'
    home["C65"] = "寄附前：住民税所得割"
    home["D65"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!B10,"")'
    home["A66"] = "寄附後：所得税等"
    home["B66"] = f'=IF(\'{MODEL}\'!B2="計算可能",\'{MODEL}\'!K{CANDIDATE},"")'
    home["C66"] = "寄附後：住民税所得割"
    home["D66"] = f'=IF(\'{MODEL}\'!B2="計算可能",SUM(\'{MODEL}\'!O{CANDIDATE}:P{CANDIDATE}),"")'
    note(home, 67, '=A1&"。所得税等は源泉徴収精算前。試算対象を超える場合は税額等を保留。正式リリースHOLD。"')
    home["A68"] = "所得年／住民税年度"
    home["B68"] = '=IF(B55="計算可能",D50&"／"&(D50+1),"")'
    home["C68"] = "住民税特例控除割合"
    home["D68"] = f"""=IF('{MODEL}'!B2="計算可能",'{MODEL}'!B6/100000,"")"""
    home["A69"] = "最大寄附額（1円単位）"
    home["B69"] = f'=IFERROR(\'{MODEL}\'!B15,"")'
    home["C69"] = "最大額の千円未満切捨て"
    home["D69"] = '=IF(ISNUMBER(B69),INT(B69/1000)*1000,"")'
    note(home, 70, '=IF(B55<>"計算可能","",IF(NOT(ISNUMBER(B69)),"SAFE-TAX-018 最大額の検証が停止しました。担当者に確認してください。",IF(AND(D69>2000,D69<>B56),"千円未満切捨て額の自己負担は2,000円超です。千円単位で寄附する場合は上の寄附目安を使ってください。","")))')
    for row in list(range(56, 67)) + [68, 69]:
        home.row_dimensions[row].height = 25
        for col in "ABCD":
            cell = home[f"{col}{row}"]
            cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="right" if col != "A" else "left")
            if cell.data_type == "f":
                cell.number_format = "#,##0"
                cell.fill = PatternFill("solid", fgColor="EAF3EA")
                cell.protection = Protection(locked=True)

    bar(home, 71, "詳細設定 | 税額控除（該当なしは0）")
    for row, label in enumerate((
        "住宅の居住開始年", "適用上限反映済み残高", "住宅の控除可能額",
        "対象国内普通配当（内数）", "適格外国所得税額", "調整国外所得金額（内数）",
    ), 72):
        field(f"D{row}", label, 0)
    note(home, 78, "住宅は通常0.7％。適格性・住宅区分・入居年・控除期間と上限を申告書で照合。配当は総合課税の対象国内普通配当。外国税は所得税枠内のみ。")
    for row, label in enumerate(("所得税（復興税を除く）", "復興特別所得税", "住宅控除（国税）",
                                 "住宅控除（住民税移行）", "配当控除（国税）", "外国税額控除（国税）"), 81):
        home.cell(row, 1, label)
        home[f"B{row}"] = f'''=IF(B55="計算可能",'{MODEL}'!E{row-79},"")'''
        home[f"D{row}"] = f'''=IF(B55="計算可能",'{MODEL}'!F{row-79},"")'''
        for col in "BD":
            home[f"{col}{row}"].number_format = "#,##0"
    home["B80"] = "寄附前"
    home["D80"] = "寄附後"
    note(home, 79, "外国税の限度額分母が所得合計と一致し、繰越や調整がない案件のみ。その他の税額控除、特殊な住宅・配当、非課税は個別計算。")
    home["D68"].number_format = "0.000%"
    home_ref = "'操作画面'!"
    model["A1"] = "申告分離課税・独立計算（合成検証版）"
    model["B3"] = f"=SUM({home_ref}B45:B51)"
    model["B4"] = f'=LOOKUP(B3,{{0,1320001,3360001,4890001,6550001}},IF({home_ref}D50=2025,{{950000,880000,680000,630000,580000}},{{1040000,1040000,1040000,670000,620000}}))'
    model["B5"] = f'=IF({home_ref}D51="標準指定都市",4,3)'
    valid_range = f"{home_ref}B45:B51"
    deduction_range = f"{home_ref}D45:D48"
    credit_range = f"{home_ref}D72:D77"
    grid_last = GRID_FIRST + (SPEC["gridMaximum"] - 3000) // SPEC["gridStep"]
    last = FIRST + len(buckets) - 1

    def housing_cap(ordinary):
        return f"MIN(97500,INT(({ordinary}+$D$3)/20))"

    def housing_unused(gross):
        return f"MAX(0,$D$4-MAX(0,{gross}-$D$5))"

    def after_housing(gross):
        return f"MAX(0,{gross}-$D$5-$D$4)"

    def national_annual(gross):
        balance = after_housing(gross)
        return f"{balance}+INT({balance}*21/1000)-$D$6"

    def local_tax(levy, share, transfer, donation_credit=0):
        return f"MAX(0,INT(({levy}-{credit_dividend}*28*{share}/5-{transfer}*200*{share}-{donation_credit}*1000)/100000))*100"

    credit_dividend = f"{home_ref}$D$75"
    gross_before = f"SUM(H{FIRST}:H{last})"
    model["D2"] = f"=OR({home_ref}D74>0,{home_ref}D75>0,{home_ref}D76>0)"
    model["D3"] = f"=IF(AND({home_ref}D72>=2022,{home_ref}D72<2026),MAX(0,B4-480000),0)"
    model["D4"] = f"={home_ref}D74"
    model["D5"] = f"=INT({credit_dividend}/10)"
    model["D6"] = f"={home_ref}D76"
    model["D7"] = f"=MIN({housing_unused(gross_before)},{housing_cap(f'E{FIRST}')})"
    model["D8"] = f"={housing_cap(f'C{grid_last}')}"
    model["D9"] = f"={housing_unused(f'J{grid_last}')}"
    model["D10"] = f"=MIN({after_housing(f'J{grid_last}')},{after_housing(f'J{CANDIDATE}')})"
    model["D11"] = f"=AND(OR({home_ref}D72<>0,{home_ref}D73<>0,D4<>0),OR({home_ref}D72<2022,{home_ref}D72>{home_ref}D50,B3>20000000,D4=0,{home_ref}D73>50000000,D4<>INT({home_ref}D73*7/100000)*100))"
    model["D12"] = f"=OR({home_ref}D75>{home_ref}B45,AND({home_ref}D75>0,B3>10000000),(D6=0)<>({home_ref}D77=0),{home_ref}D77>{home_ref}B45)"
    model["D13"] = f"=AND(D4>0,D8<{housing_cap(f'E{FIRST}')},D9>D8)"
    model["D14"] = f"=D6*B3>D10*{home_ref}D77"
    model["D15"] = f"=AND(B3={home_ref}B45,G{FIRST}-{home_ref}D47-MAX(0,B4-480000)<0)"
    for col, gross, ordinary, transfer in (
        ("E", gross_before, f"E{FIRST}", "$D$7"),
        ("F", f"J{CANDIDATE}", f"C{CANDIDATE}", f"AA{CANDIDATE}"),
    ):
        model[f"{col}2"] = f"={after_housing(gross)}-$D$6"
        model[f"{col}3"] = f"=INT({after_housing(gross)}*21/1000)"
        model[f"{col}4"] = f"=MIN($D$4,MAX(0,{gross}-$D$5))"
        model[f"{col}5"] = f"={transfer}"
        model[f"{col}6"] = f"=MIN({gross},$D$5)"
        model[f"{col}7"] = "=$D$6"
        model[f"{col}8"] = f"={housing_cap(ordinary)}"
        model[f"{col}9"] = f"={gross}"
    model["E10"] = f"={local_tax('B8', '$B$5', '$D$7')}"
    model["E11"] = f"={local_tax('B9', '(5-$B$5)', '$D$7')}"
    model["B2"] = (
        f'=IFERROR(IF({home_ref}B44="給与・通常","詳細設定を使用していません",'
        f'IF({home_ref}B44<>"申告分離","SAFE-TAX-011 利用者操作が必要。案件区分を選択して再計算。",'
        f'IF({home_ref}D44<>"確定申告","SAFE-TAX-012 利用者操作が必要。確定申告を選択して再計算。",'
        f'IF({home_ref}D49<>"照合済","SAFE-TAX-013 対象外または要確認。適用条件を照合。特例ありは個別計算。",'
        f'IF(AND({home_ref}D51<>"標準市町村",{home_ref}D51<>"標準指定都市"),'
        f'"SAFE-TAX-019 自治体の条例と税率を確認。超過課税等は個別計算。",'
        f'IF(OR(AND({home_ref}D50<>2025,{home_ref}D50<>2026),COUNT({valid_range},{deduction_range},{credit_range})<>17,'
        f'MIN({valid_range},{deduction_range},{credit_range})<0,MAX({valid_range},{deduction_range},{credit_range})>100000000,'
        f'SUMPRODUCT(--(MOD({valid_range},1)<>0))+SUMPRODUCT(--(MOD({deduction_range},1)<>0))+SUMPRODUCT(--(MOD({credit_range},1)<>0))>0),'
        f'"SAFE-TAX-011 要確認。所得年と全金額を確認。該当なしは0。",'
        f'IF(OR(B3<1000000,B3>{SPEC["maximumIncome"]},AND(B3={home_ref}B45,NOT(D2)),'
        f'AND({home_ref}B48>0,B3-{home_ref}B45>{home_ref}B48)),'
        f'"SAFE-TAX-014 対象外。所得額・配当と他の分離所得の併用を個別確認。",'
        f'IF(OR({home_ref}D45<B4,{home_ref}D46<430000,{home_ref}D47<50000),'
        '"SAFE-TAX-015 安全停止。基礎控除を含む税目別控除・法定人的控除差を照合。",'
        'IF(D11,"SAFE-TAX-020 住宅の入居年・適用上限反映済み残高・控除可能額を照合。",'
        'IF(D12,"SAFE-TAX-023 配当の対象区分・調整国外所得・外国所得税額を照合。",'
        'IF(D13,"SAFE-TAX-021 住宅控除の住民税上限が寄附で変動。担当者が個別に計算。",'
        'IF(D14,"SAFE-TAX-022 外国税が所得税の限度を超過。残余・繰越は個別計算。",'
        'IF(D15,"SAFE-TAX-024 総合課税のみで特例割合の判定額が負。控除明細を個別確認。",'
        '"計算可能"))))))))))))),"SAFE-TAX-011 要確認。入力エラーを修正して再計算。")'
    )
    model["B6"] = f'=IF(AND(G{FIRST}>0,G{FIRST}-{home_ref}D47-MAX(0,B4-480000)>=0),90000-1021*LOOKUP(G{FIRST}-{home_ref}D47-MAX(0,B4-480000),{{0,1950001,3300001,6950001,9000001,18000001,40000001}},{{5,10,20,23,33,40,45}}),IF(B{FIRST+1}>0,59370,74685))'
    model["B7"] = f"={national_annual(gross_before)}"
    model["B8"] = f'=MAX(0,SUM(I{FIRST}:I{last})-B11*B5*10)'
    model["B9"] = f'=MAX(0,SUM(J{FIRST}:J{last})-B11*(5-B5)*10)'
    model["B10"] = "=E10+E11"
    model["B11"] = f'=IF(G{FIRST}<=2000000,MIN(G{FIRST},{home_ref}D47),MAX(50000,{home_ref}D47-G{FIRST}+2000000))'
    model["B12"] = f'=MAX(T{GRID_FIRST}:T{grid_last})'
    model["B13"] = f'=MAX(0,{home_ref}D45-SUM(B{FIRST}:B{last}))'
    model["B14"] = f'=MAX(0,{home_ref}D46-SUM(B{FIRST}:B{last}))'
    exact_last = GRID_FIRST + EXACT_STEPS - 1
    bounds = f"U{GRID_FIRST}:U{exact_last}"
    model["B15"] = (
        f'=IF(B2<>"計算可能","",IF(OR(COUNT({bounds})<{EXACT_STEPS},U{exact_last}=Z{exact_last}),'
        f'INDEX({bounds},COUNT({bounds})),NA()))'
    )
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
        combined_rate = bucket[3] + bucket[4] if index else 100
        model[f"I{row}"] = f"=G{row}*{combined_rate}*$B$5/5"
        model[f"J{row}"] = f"=G{row}*{combined_rate}*(5-$B$5)/5"
    for col, label in enumerate(("寄附", "国税寄附金控除", *[b[0] for b in buckets], "所得税", "所得税等",
                                 "基本控除対象（0.1円単位）", "市控除", "県控除", "市税", "県税",
                                 "国税軽減", "住民税軽減", "自己負担", "採用額"), 1):
        model.cell(26, col, label)
    for row in [23, 24, *range(CANDIDATE, grid_last + 1)]:
        if row in (23, 24):
            model[f"A{row}"] = "=N(B15)" if row == 23 else "=N(B15)+1"
        elif row == CANDIDATE:
            model[f"A{row}"] = f"={home_ref}D48"
        else:
            model[f"A{row}"] = 3000 + (row - GRID_FIRST) * SPEC["gridStep"]
        model[f"B{row}"] = f"=MAX(0,MIN(A{row},INT($B$3*4/10))-2000)"
        for index, bucket in enumerate(buckets):
            src = FIRST + index
            prev = f"SUM($B${FIRST}:$B${src-1})" if index else "0"
            col = get_column_letter(3 + index)
            model[f"{col}{row}"] = f"=INT(MAX(0,$B${src}-MAX(0,{home_ref}$D$45+B{row}-{prev}))/1000)*1000"
        model[f"J{row}"] = f'={progressive(f"C{row}")}+' + "+".join(
            f"{get_column_letter(3 + i)}{row}*{bucket[2]}/100" for i, bucket in enumerate(buckets) if i)
        model[f"K{row}"] = f"={national_annual(f'J{row}')}"
        model[f"AA{row}"] = f"=MIN({housing_unused(f'J{row}')},{housing_cap(f'C{row}')})"
        model[f"L{row}"] = f"=MAX(0,MIN(A{row}*10,$B$3*3)-20000)"
        model[f"M{row}"] = f"=ROUNDUP((L{row}*$B$5*10000+MIN($B$8*1000,MAX(0,A{row}-2000)*$B$6*$B$5*10))/5000000,0)"
        model[f"N{row}"] = f"=ROUNDUP((L{row}*(5-$B$5)*10000+MIN($B$9*1000,MAX(0,A{row}-2000)*$B$6*(5-$B$5)*10))/5000000,0)"
        model[f"O{row}"] = f"={local_tax('$B$8', '$B$5', f'AA{row}', f'M{row}')}"
        model[f"P{row}"] = f"={local_tax('$B$9', '(5-$B$5)', f'AA{row}', f'N{row}')}"
        model[f"Q{row}"] = f"=$B$7-K{row}"
        model[f"R{row}"] = f"=$B$10-O{row}-P{row}"
        model[f"S{row}"] = f"=A{row}-Q{row}-R{row}"
        model[f"T{row}"] = f'=IF(AND($B$2="計算可能",S{row}<=2000),A{row},0)'

    # Each row evaluates the upper bound with native Excel formulas. The
    # next row drops only amounts proven infeasible by nondecreasing relief.
    for row in range(GRID_FIRST, exact_last + 1):
        prior = row - 1
        if row == GRID_FIRST:
            model[f"U{row}"] = f'=IF($B$2="計算可能",{SPEC["gridMaximum"]},"")'
        else:
            model[f"U{row}"] = f'=IF(OR(U{prior}="",U{prior}=Z{prior}),"",Z{prior})'
        guard = f'IF(U{row}="","",'
        model[f"V{row}"] = f'={guard}MAX(0,MIN(U{row},INT($B$3*4/10))-2000))'
        taxable = []
        for index in range(len(buckets)):
            source = FIRST + index
            prev = f"SUM($B${FIRST}:$B${source-1})" if index else "0"
            taxable.append(f"INT(MAX(0,$B${source}-MAX(0,{home_ref}$D$45+V{row}-{prev}))/1000)*1000")
        model[f"AA{row}"] = f"={guard}{taxable[0]})"
        base = progressive(f"AA{row}") + "+" + "+".join(
            f"{taxable[i]}*{buckets[i][2]}/100" for i in range(1, len(buckets))
        )
        model[f"W{row}"] = f"={guard}{base})"
        model[f"AB{row}"] = f"={guard}MIN({housing_unused(f'W{row}')},{housing_cap(f'AA{row}')}))"
        basic = f"MAX(0,MIN(U{row}*10,$B$3*3)-20000)"
        for column, levy_row, share in (("X", 8, "$B$5"), ("Y", 9, "(5-$B$5)")):
            levy = f"$B${levy_row}"
            credit = (f"ROUNDUP(({basic}*{share}*10000+"
                      f"MIN({levy}*1000,MAX(0,U{row}-2000)*$B$6*{share}*10))/5000000,0)")
            model[f"{column}{row}"] = f"={guard}{local_tax(levy, share, f'AB{row}', credit)})"
        model[f"Z{row}"] = f"={guard}MIN(U{row},2000+$B$7-({national_annual(f'W{row}')})+$B$10-X{row}-Y{row}))"
    return MODEL
