Attribute VB_Name = "BatchWithholding"
Option Explicit

' Excel 365 desktop. One local PDF page is ONE provisional taxpayer record.
' All amounts are transferred through an allowlisted, ASCII-only bridge.
' Do not infer personal identifiers, support automatically, or certify totals.
Private Const SHEET_BATCH As String = "一括試算一覧"
Private Const SHEET_HOME As String = "操作画面"
Private Const SHEET_ADV As String = "例外・分離課税"
Private Const START_ROW As Long = 7
Private Const END_ROW As Long = 26
Private mWorking As Boolean

Private Sub BindOne(ByVal sheetName As String, ByVal buttonName As String, ByVal procedure As String)
    Dim target As Object
    Set target = ThisWorkbook.Worksheets(sheetName).Buttons(buttonName)
    target.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!BatchWithholding." & procedure
End Sub

Public Sub BindButtons()
    BindOne SHEET_HOME, "btnShowBatch", "ShowBatch"
    BindOne SHEET_BATCH, "btnBatchImport", "BatchImport"
    BindOne SHEET_BATCH, "btnBatchCalculate", "BatchCalculate"
    BindOne SHEET_BATCH, "btnBatchClear", "BatchClear"
    BindOne SHEET_BATCH, "btnBatchPrint", "BatchPrint"
    BindOne SHEET_BATCH, "btnBatchReturnHome", "BatchReturnHome"
End Sub

Public Sub ShowBatch()
    ThisWorkbook.Worksheets(SHEET_BATCH).Visible = xlSheetVisible
    ThisWorkbook.Worksheets(SHEET_BATCH).Activate
End Sub

Public Sub BatchReturnHome()
    ThisWorkbook.Worksheets(SHEET_HOME).Activate
    ThisWorkbook.Worksheets(SHEET_BATCH).Visible = xlSheetVeryHidden
End Sub

Private Function AsciiUnsigned(ByVal raw As String) As Boolean
    Dim i As Long, code As Long
    If Len(raw) < 1 Or Len(raw) > 13 Then Exit Function
    For i = 1 To Len(raw)
        code = AscW(Mid$(raw, i, 1))
        If code < 48 Or code > 57 Then Exit Function
    Next i
    AsciiUnsigned = True
End Function

Private Function AllowedField(ByVal key As String) As Boolean
    Select Case key
        Case "salary_gross", "salary_reference", "deductions_reference", _
             "income_tax_withheld", "social_insurance", _
             "life_deduction_reference", "earthquake_deduction_reference", _
             "mortgage_credit", "mortgage_possible_credit", _
             "mortgage_occupancy_year", "mortgage_claim_count", _
             "life_new", "life_old", "medical_care", "annuity_new", _
             "annuity_old", "earthquake_paid", "income_adjustment", _
             "under16_count", "special_relative_count", _
             "special_relative_deduction_reference", "basic_reference"
            AllowedField = True
    End Select
End Function

Private Function ColumnForField(ByVal key As String) As String
    Select Case key
        Case "salary_gross": ColumnForField = "D"
        Case "salary_reference": ColumnForField = "K"
        Case "deductions_reference": ColumnForField = "L"
        Case "income_tax_withheld": ColumnForField = "M"
        Case "social_insurance": ColumnForField = "N"
        Case "life_deduction_reference": ColumnForField = "O"
        Case "earthquake_deduction_reference": ColumnForField = "P"
        Case "mortgage_credit": ColumnForField = "Q"
        Case "mortgage_possible_credit": ColumnForField = "R"
        Case "mortgage_occupancy_year": ColumnForField = "S"
        Case "mortgage_claim_count": ColumnForField = "T"
        Case "life_new": ColumnForField = "U"
        Case "life_old": ColumnForField = "V"
        Case "medical_care": ColumnForField = "W"
        Case "annuity_new": ColumnForField = "X"
        Case "annuity_old": ColumnForField = "Y"
        Case "earthquake_paid": ColumnForField = "Z"
        Case "income_adjustment": ColumnForField = "AA"
        Case "under16_count": ColumnForField = "AB"
        Case "special_relative_count": ColumnForField = "AC"
        Case "special_relative_deduction_reference": ColumnForField = "AD"
        ' basic_reference is supplemental and intentionally not auto-imported.
    End Select
End Function

Private Function ParseBatchBridge(ByVal path As String) As Collection
    Dim fso As Object, handle As Object, all As Collection, record As Object
    Dim line As String, pair As Variant, name As String, val As String
    Dim code As Long, pieces As Variant, word As Variant, i As Long
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set all = New Collection
    Set handle = fso.OpenTextFile(path, 1, False, 0)
    On Error GoTo Failed
    Do Until handle.AtEndOfStream
        line = handle.ReadLine
        pair = Split(line, vbTab)
        If UBound(pair) <> 1 Then Err.Raise vbObjectError + 901, , "一括読取データが破損しています。"
        name = CStr(pair(0)): val = CStr(pair(1))
        Select Case name
            Case "PAGE"
                If Not record Is Nothing Then Err.Raise vbObjectError + 902, , "PDFページ区切りが不正です。"
                If Not AsciiUnsigned(val) Then Err.Raise vbObjectError + 903, , "PDFページ番号が不正です。"
                If CLng(val) <> all.Count + 1 Or CLng(val) > 20 Then _
                    Err.Raise vbObjectError + 904, , "PDFページ番号が重複・飛び番です。"
                Set record = CreateObject("Scripting.Dictionary")
                record.Add "PAGE", val
            Case "ENDPAGE"
                If record Is Nothing Then Err.Raise vbObjectError + 905, , "PDFページ終端がありません。"
                If Not AsciiUnsigned(val) Or CLng(val) <> CLng(record("PAGE")) Then _
                    Err.Raise vbObjectError + 906, , "PDFページ終端番号が不正です。"
                If Not record.Exists("STATUS") Or Not record.Exists("YEAR") Or _
                   Not record.Exists("WARNINGS") Then _
                    Err.Raise vbObjectError + 907, , "PDFページの検証情報が不足しています。"
                all.Add record
                Set record = Nothing
            Case Else
                If record Is Nothing Then Err.Raise vbObjectError + 908, , "PDF外の項目が混入しています。"
                If record.Exists(name) Then Err.Raise vbObjectError + 909, , "重複読取項目が混入しています。"
                Select Case name
                    Case "STATUS"
                        If val <> "READY_FOR_EXCEL_CROSSCHECK" And val <> "REQUIRES_REVIEW" Then _
                            Err.Raise vbObjectError + 910, , "PDFの確認状態が不明です。"
                    Case "YEAR"
                        If Len(val) > 0 And Not AsciiUnsigned(val) Then _
                            Err.Raise vbObjectError + 911, , "所得年が不正です。"
                    Case "WARNINGS"
                        If Len(val) > 0 Then
                            pieces = Split(val, ";")
                            For Each word In pieces
                                If Len(CStr(word)) = 0 Then Err.Raise vbObjectError + 912, , "読取警告が不正です。"
                                For i = 1 To Len(CStr(word))
                                    code = AscW(Mid$(CStr(word), i, 1))
                                    If Not ((code >= 65 And code <= 90) Or _
                                            (code >= 48 And code <= 57) Or code = 95) Then _
                                        Err.Raise vbObjectError + 913, , "読取警告形式が不正です。"
                                Next i
                            Next word
                        End If
                    Case Else
                        If Not AllowedField(name) Or Not AsciiUnsigned(val) Then _
                            Err.Raise vbObjectError + 914, , "許可されていない金額が含まれています。"
                        If CDbl(val) > 1000000000000# Then _
                            Err.Raise vbObjectError + 915, , "金額の上限を超えています。"
                End Select
                record.Add name, val
        End Select
    Loop
    handle.Close
    Set handle = Nothing
    If Not record Is Nothing Or all.Count < 1 Or all.Count > 20 Then _
        Err.Raise vbObjectError + 916, , "PDFページ数や終端に不整合があります。"
    Set ParseBatchBridge = all
    Exit Function
Failed:
    On Error Resume Next
    If Not handle Is Nothing Then handle.Close
    Err.Raise vbObjectError + 917, , "一括読取データの安全性検証に失敗しました。"
End Function

Public Sub BatchImport()
    Dim selected As Variant, fso As Object, shell As Object, executable As String
    Dim outputJson As String, outputTsv As String, command As String, rc As Long
    Dim all As Collection, record As Object, ws As Worksheet
    Dim idx As Long, rowNum As Long, item As Variant, col As String
    On Error GoTo Failed
    If mWorking Then Exit Sub
    selected = Application.GetOpenFilename("PDF (*.pdf),*.pdf", 1, "複数人の源泉徴収票PDFを選択")
    If VarType(selected) = vbBoolean Then Exit Sub
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then _
        Err.Raise vbObjectError + 918, , "書き込み可能なローカルExcelブックが必要です。"
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    If Application.CountA(ws.Range("A7:A26")) > 0 Then _
        Err.Raise vbObjectError + 919, , "既存の一覧があります。保存後に「一覧初期化」で消去してください。"
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.GetFile(CStr(selected)).Size > 25 * 1024 * 1024 Then _
        Err.Raise vbObjectError + 920, , "PDFは25MB以下を指定してください。"
    executable = fso.BuildPath(ThisWorkbook.Path, "FurusatoDocumentReader.exe")
    If Not fso.FileExists(executable) Then _
        Err.Raise vbObjectError + 921, , "読取EXEがありません。Windows配布ZIPを展開してください。"
    outputJson = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName & ".json")
    outputTsv = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName & ".tsv")
    command = Chr$(34) & executable & Chr$(34) & " --input " & Chr$(34) & CStr(selected) & _
              Chr$(34) & " --output " & Chr$(34) & outputJson & Chr$(34) & _
              " --batch-bridge " & Chr$(34) & outputTsv & Chr$(34)
    mWorking = True
    Set shell = CreateObject("WScript.Shell")
    rc = shell.Run(command, 0, True)
    If rc <> 0 Or Not fso.FileExists(outputTsv) Then _
        Err.Raise vbObjectError + 922, , "PDFのページ別読取に失敗しました。"
    Set all = ParseBatchBridge(outputTsv)
    ' Only write after every block and every value has passed validation.
    ws.Range("A7:AF26").ClearContents
    For idx = 1 To all.Count
        Set record = all(idx)
        rowNum = START_ROW + idx - 1
        ws.Cells(rowNum, "A").Value2 = CLng(record("PAGE"))
        If Len(CStr(record("YEAR"))) > 0 Then ws.Cells(rowNum, "C").Value2 = CLng(record("YEAR"))
        ws.Cells(rowNum, "AE").Value2 = CStr(record("STATUS"))
        ws.Cells(rowNum, "AF").Value2 = CStr(record("WARNINGS"))
        For Each item In record.Keys
            col = ColumnForField(CStr(item))
            If Len(col) > 0 Then ws.Range(col & CStr(rowNum)).Value2 = CDbl(record(item))
        Next item
        ws.Cells(rowNum, "H").Value2 = "未確認"
        ws.Cells(rowNum, "I").Value2 = "未確認"
        ws.Cells(rowNum, "J").Value2 = "ワンストップ"
        ws.Cells(rowNum, "F").Value2 = "HOLD"
        ws.Cells(rowNum, "G").Value2 = "原票の金額・所得年と追加条件を個別確認してください"
        If CStr(record("STATUS")) <> "READY_FOR_EXCEL_CROSSCHECK" Then _
            ws.Cells(rowNum, "G").Value2 = "読取要確認：原票と数値を照合してください"
    Next idx
    MsgBox CStr(all.Count) & "ページを読み取り、対象者別の確認一覧を作成しました。" & vbCrLf & _
           "H列・I列を各人ごとに確認するまで寄附限度額は表示しません。", vbInformation
CleanUp:
    On Error Resume Next
    mWorking = False
    If Not fso Is Nothing Then
        If Len(outputJson) > 0 And fso.FileExists(outputJson) Then fso.DeleteFile outputJson, True
        If Len(outputTsv) > 0 And fso.FileExists(outputTsv) Then fso.DeleteFile outputTsv, True
    End If
    Exit Sub
Failed:
    MsgBox "複数PDF取込： " & Err.Description, vbExclamation
    Resume CleanUp
End Sub

Public Sub BatchClear()
    Dim previousEvents As Boolean
    If mWorking Then Exit Sub
    If MsgBox("現在の一括一覧を消去しますか？保存が必要な場合は先に案件保存してください。", _
              vbQuestion + vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    mWorking = True
    previousEvents = Application.EnableEvents
    On Error GoTo RestoreClearEvents
    Application.EnableEvents = False
    ThisWorkbook.Worksheets(SHEET_BATCH).Range("A7:AF26").ClearContents
RestoreClearEvents:
    Application.EnableEvents = previousEvents
    mWorking = False
End Sub

Private Function SnapshotInputs() As Object
    Dim data As Object, refs As Variant, addr As Variant, ws As Worksheet
    Set data = CreateObject("Scripting.Dictionary")
    Set ws = ThisWorkbook.Worksheets(SHEET_HOME)
    For Each addr In Split("B4 B11 B12 B15 B16 B19 B20 B21 B22 B23 B24 B25 B33 B34 B35 B36 D24", " ")
        data.Add "H|" & CStr(addr), ws.Range(CStr(addr)).Formula
    Next addr
    Dim n As Long
    For n = 11 To 23
        data.Add "H|D" & CStr(n), ws.Range("D" & CStr(n)).Formula
    Next n
    Set ws = ThisWorkbook.Worksheets(SHEET_ADV)
    For Each addr In Split("B5 B6 B8 B9 B10 B11 B12 B13 B14 B15 B16 B17 B18 B19 B20 B21 B24 B25 B26 B32 B33 B36 B38 B39", " ")
        data.Add "E|" & CStr(addr), ws.Range(CStr(addr)).Formula
    Next addr
    Set SnapshotInputs = data
End Function

Private Sub RestoreInputs(ByVal data As Object)
    Dim key As Variant, parts As Variant, ws As Worksheet
    If data Is Nothing Then Exit Sub
    For Each key In data.Keys
        parts = Split(CStr(key), "|")
        If parts(0) = "H" Then
            Set ws = ThisWorkbook.Worksheets(SHEET_HOME)
        Else
            Set ws = ThisWorkbook.Worksheets(SHEET_ADV)
        End If
        ws.Range(CStr(parts(1))).Formula = data(key)
    Next key
End Sub

Private Sub ApplyCaseRow(ByVal ws As Worksheet, ByVal index As Long)
    Dim home As Worksheet, extra As Worksheet, keys As Variant, targets As Variant
    Dim idx As Long
    Set home = ThisWorkbook.Worksheets(SHEET_HOME)
    Set extra = ThisWorkbook.Worksheets(SHEET_ADV)
    home.Range("B11:B12,B15:B16,B19:B25,B33:B36,D11:D24").ClearContents
    extra.Range("B5:B6,B8:B21,B24:B26,B32,B33,B36,B38:B39").ClearContents
    home.Range("B4").Value2 = ws.Cells(index, "C").Value2
    home.Range("B11").Value2 = ws.Cells(index, "C").Value2
    home.Range("B25").Value2 = "なし"
    home.Range("D22").Value2 = "該当なし"
    home.Range("D24").Value2 = ws.Cells(index, "J").Value2
    extra.Range("B25").Value2 = "なし"
    extra.Range("B33").Value2 = "なし"
    keys = Array("D", "M", "N", "U", "V", "W", "X", "Y", "Z", _
                 "Q", "R", "S", "T", "AB", "K", "L", "O", "P", "AA", "AC", "AD")
    targets = Array("H|B12", "H|B15", "H|B16", "H|B19", "H|B20", _
                    "H|B23", "H|B21", "H|B22", "H|B24", _
                    "H|B33", "H|B34", "H|B35", "H|B36", "H|D23", _
                    "E|B15", "E|B14", "E|B16", "E|B17", "E|B13", "E|B38", "E|B39")
    Dim value As Variant, target As String
    For idx = LBound(keys) To UBound(keys)
        value = ws.Cells(index, CStr(keys(idx))).Value2
        If Len(Trim$(CStr(value))) > 0 Then
            target = CStr(targets(idx))
            If Left$(target, 1) = "H" Then
                home.Range(Mid$(target, 3)).Value2 = value
            Else
                extra.Range(Mid$(target, 3)).Value2 = value
            End If
        End If
    Next idx
    If IsNumeric(ws.Cells(index, "AB").Value2) Then
        If CDbl(ws.Cells(index, "AB").Value2) > 0 Then home.Range("B25").Value2 = "あり"
    End If
    extra.Range("B19").Value2 = "ローカル一括：原票照合済"
    extra.Range("B20").Value2 = "VERIFIED_AFTER_CORRECTION"
    extra.Range("B32").Value2 = ws.Cells(index, "AF").Value2
End Sub

Private Function NumericYen(ByVal value As Variant) As Boolean
    On Error GoTo Invalid
    If IsEmpty(value) Or IsError(value) Or Not IsNumeric(value) Then Exit Function
    NumericYen = CDbl(value) >= 0 And CDbl(value) <= 1000000000000# And _
                 CDbl(value) = Fix(CDbl(value))
    Exit Function
Invalid:
    NumericYen = False
End Function

Private Function ReviewWarningsSafe(ByVal status As String, ByVal warnings As String) As Boolean
    Dim flag As Variant
    If status = "READY_FOR_EXCEL_CROSSCHECK" Then
        ReviewWarningsSafe = True
        Exit Function
    End If
    If status <> "REQUIRES_REVIEW" Then Exit Function
    For Each flag In Split(warnings, ";")
        Select Case CStr(flag)
            Case "OCR_REQUIRES_VERIFICATION", "INCOMPLETE_OR_UNVERIFIED"
            Case Else: Exit Function
        End Select
    Next flag
    ReviewWarningsSafe = True
End Function

Public Sub BatchCalculate()
    Dim ws As Worksheet, home As Worksheet, settings As Worksheet
    Dim cache As Object, initialEvents As Boolean, initialScreen As Boolean
    Dim index As Long, reason As String, amount As Variant, year As Long
    Dim sourceYear As Variant, header As Variant, good As Long, hold As Long
    Dim originalError As String, priorPageCount As Long
    If mWorking Then Exit Sub
    initialEvents = Application.EnableEvents
    initialScreen = Application.ScreenUpdating
    On Error GoTo Failed
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    Set home = ThisWorkbook.Worksheets(SHEET_HOME)
    Set settings = ThisWorkbook.Worksheets("設定・税率")
    If Application.CountA(ws.Range("A7:A26")) = 0 Then _
        Err.Raise vbObjectError + 923, , "まず複数ページPDFを読み取ってください。"
    priorPageCount = Application.CountA(ws.Range("A7:A26"))
    For index = START_ROW To START_ROW + priorPageCount - 1
        If Not NumericYen(ws.Cells(index, "A").Value2) Then _
            Err.Raise vbObjectError + 924, , "ページ番号が欠落しています。PDFを再読込してください。"
        If CLng(ws.Cells(index, "A").Value2) <> index - START_ROW + 1 Then _
            Err.Raise vbObjectError + 925, , "ページ番号が変更または入替されています。"
    Next index
    If priorPageCount > END_ROW - START_ROW + 1 Then _
        Err.Raise vbObjectError + 926, , "20ページ上限を超えました。"
    For index = START_ROW + priorPageCount To END_ROW
        If Len(Trim$(CStr(ws.Cells(index, "F").Value2))) > 0 Or _
           Len(Trim$(CStr(ws.Cells(index, "E").Value2))) > 0 Then
            ws.Cells(index, "E").ClearContents
            ws.Cells(index, "F").Value2 = "HOLD"
            ws.Cells(index, "G").Value2 = "一覧の対象外です。元のPDFを確認してください"
        End If
    Next index
    mWorking = True
    Application.EnableEvents = False
    Application.ScreenUpdating = False
    Set cache = SnapshotInputs()
    sourceYear = settings.Range("B4").Value2
    For index = START_ROW To END_ROW
        If Len(Trim$(CStr(ws.Cells(index, "A").Value2))) = 0 Then Exit For
        ws.Cells(index, "E").ClearContents
        ws.Cells(index, "F").Value2 = "HOLD"
        reason = vbNullString
        If ws.Cells(index, "H").Value2 <> "照合済" Or _
           ws.Cells(index, "I").Value2 <> "未対応条件なし" Then
            reason = "原票の金額・年分と未対応条件の確認待ち"
        ElseIf Not NumericYen(ws.Cells(index, "C").Value2) Then
            reason = "所得年を確認できません"
        ElseIf CLng(ws.Cells(index, "C").Value2) <> CLng(sourceYear) Then
            reason = "承認済み税制年と所得年が異なります"
        ElseIf CLng(sourceYear) <> 2025 And CLng(sourceYear) <> 2026 Then
            reason = "未承認の税制年です"
        ElseIf Not ReviewWarningsSafe(CStr(ws.Cells(index, "AE").Value2), _
                                           CStr(ws.Cells(index, "AF").Value2)) Then
            reason = "OCR・原票構造に個別照合が必要です"
        ElseIf Not NumericYen(ws.Cells(index, "D").Value2) Or _
               Not NumericYen(ws.Cells(index, "K").Value2) Or _
               Not NumericYen(ws.Cells(index, "L").Value2) Or _
               Not NumericYen(ws.Cells(index, "M").Value2) Or _
               Not NumericYen(ws.Cells(index, "N").Value2) Then
            reason = "計算用の5金額に欠落または異常があります"
        ElseIf IsNumeric(ws.Cells(index, "AC").Value2) And _
               Val(CStr(ws.Cells(index, "AC").Value2)) > 0 Then
            reason = "特定親族の所得内訳が必要です（単票画面で確認）"
        ElseIf ws.Cells(index, "J").Value2 <> "ワンストップ" And _
               ws.Cells(index, "J").Value2 <> "確定申告" Then
            reason = "申告方法を選択してください"
        Else
            On Error Resume Next
            ApplyCaseRow ws, index
            If Err.Number <> 0 Then reason = "個別入力の反映に失敗": Err.Clear
            If Len(reason) = 0 Then
                Application.Calculate
                If Err.Number <> 0 Then reason = "既存計算式の再計算に失敗": Err.Clear
            End If
            If Len(reason) = 0 Then
                If CStr(home.Range("B28").Value2) <> "正常" Then
                    reason = CStr(home.Range("B28").Value2)
                Else
                    amount = home.Range("B8").Value2
                    If NumericYen(amount) Then
                        ws.Cells(index, "E").Value2 = CDbl(amount)
                        ws.Cells(index, "F").Value2 = "概算"
                        reason = "既存計算エンジンによる概算（原票照合済）"
                        good = good + 1
                    Else
                        reason = "計算結果が数値ではありません"
                    End If
                End If
            End If
            On Error GoTo Failed
        End If
        ws.Cells(index, "G").Value2 = Left$(reason, 160)
        If ws.Cells(index, "F").Value2 = "HOLD" Then hold = hold + 1
        ' Restore the user's original single-person input BEFORE next case.
        RestoreInputs cache
    Next index
    RestoreInputs cache
    Application.Calculate
    Application.EnableEvents = initialEvents
    Application.ScreenUpdating = initialScreen
    mWorking = False
    MsgBox "個別計算を終了しました。" & vbCrLf & "概算 " & good & "件 / HOLD " & hold & _
           "件。元の単票画面の入力は復元しました。", vbInformation
    Exit Sub
Failed:
    originalError = Err.Description
    On Error Resume Next
    ' Abort is atomic as to published estimates: no partial results survive.
    If Not ws Is Nothing Then
        ws.Range("E7:E26").ClearContents
        For index = START_ROW To END_ROW
            If Len(Trim$(CStr(ws.Cells(index, "A").Value2))) > 0 Then
                ws.Cells(index, "F").Value2 = "HOLD"
                ws.Cells(index, "G").Value2 = "一括試算を中断しました。全件再確認・再計算してください"
            End If
        Next index
    End If
    RestoreInputs cache
    Application.Calculate
    Application.EnableEvents = initialEvents
    Application.ScreenUpdating = initialScreen
    mWorking = False
    MsgBox "一括試算を中断しました。元の入力は復元を試みました。" & vbCrLf & _
           "エラー: " & originalError, vbCritical
End Sub

' Every manual edit invalidates prior estimates. Monetary changes also
' invalidate the operator's former confirmation; labels alone do not.
Public Sub BatchInvalidate(ByVal changed As Range)
    Dim ws As Worksheet, touched As Range, cell As Range
    Dim changedRows As Object, taxRows As Object, rowKey As Variant
    Dim wasEnabled As Boolean, index As Long
    If mWorking Then Exit Sub
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    Set touched = Application.Intersect(changed, ws.Range("A7:AF26"))
    If touched Is Nothing Then Exit Sub
    Set changedRows = CreateObject("Scripting.Dictionary")
    Set taxRows = CreateObject("Scripting.Dictionary")
    For Each cell In touched.Cells
        If cell.Column <> 2 Then
            rowKey = CStr(cell.Row)
            If Not changedRows.Exists(rowKey) Then changedRows.Add rowKey, cell.Row
            If cell.Column = 1 Or cell.Column = 3 Or cell.Column = 4 Or _
               cell.Column >= 11 Then
                If Not taxRows.Exists(rowKey) Then taxRows.Add rowKey, cell.Row
            End If
        End If
    Next cell
    If changedRows.Count = 0 Then Exit Sub
    wasEnabled = Application.EnableEvents
    On Error GoTo RestoreEvents
    Application.EnableEvents = False
    For Each rowKey In changedRows.Keys
        index = CLng(changedRows(rowKey))
        ws.Cells(index, "E").ClearContents
        ws.Cells(index, "F").Value2 = "HOLD"
        ws.Cells(index, "G").Value2 = "入力変更後のため再試算が必要です"
        If taxRows.Exists(rowKey) Then
            ws.Cells(index, "H").Value2 = "未確認"
            ws.Cells(index, "I").Value2 = "未確認"
        End If
    Next rowKey
RestoreEvents:
    Application.EnableEvents = wasEnabled
End Sub

' Called after the master/year changes successfully. Earlier estimates
' must never survive a tax revision or approved-income-year switch.
Public Sub BatchMasterChanged()
    Dim ws As Worksheet, ix As Long, priorEvents As Boolean
    If mWorking Then Exit Sub
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    priorEvents = Application.EnableEvents
    On Error GoTo ExitSafely
    Application.EnableEvents = False
    For ix = START_ROW To END_ROW
        ws.Cells(ix, "E").ClearContents
        If Len(Trim$(CStr(ws.Cells(ix, "A").Value2))) > 0 Then
            ws.Cells(ix, "F").Value2 = "HOLD"
            ws.Cells(ix, "G").Value2 = "税制変更後のため、適用年・控除条件の再確認が必要"
            ws.Cells(ix, "I").Value2 = "未確認"
        End If
    Next ix
ExitSafely:
    Application.EnableEvents = priorEvents
End Sub

Public Sub BatchPrint()
    If mWorking Then Exit Sub
    ThisWorkbook.Worksheets(SHEET_BATCH).PrintPreview
End Sub
