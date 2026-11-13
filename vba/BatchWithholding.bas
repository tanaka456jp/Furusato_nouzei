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
' Non-identifying diagnostic: stage and numeric VBA error code only.
Private mLastBatchErrorCode As String

Public Function BatchImportFailureCode() As String
    BatchImportFailureCode = mLastBatchErrorCode
End Function

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

' Nonmodal Excel COM acceptance checks the freshly installed VBA module
' without exposing a client PDF or showing any confirmation dialog.
Public Function BatchReadyForTest() As Boolean
    Dim ws As Worksheet
    On Error GoTo NotReady
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    BatchReadyForTest = (CStr(ws.Range("A6").Value2) = "PDF頁" And _
        CStr(ws.Range("E6").Value2) = "限度額の目安" And _
        ws.Buttons("btnBatchImport").Name = "btnBatchImport" And _
        ws.Buttons("btnBatchCalculate").Name = "btnBatchCalculate")
    Exit Function
NotReady:
    BatchReadyForTest = False
End Function

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
             "special_relative_deduction_reference", "basic_reference", _
             "spouse_tax_deduction", "spouse_deduction_flag", _
             "elderly_spouse_flag", "spouse_total_income", _
             "specific_dependent_count", "cohabiting_elder_count", _
             "elder_dependent_count", "general_dependent_count", _
             "cohabiting_special_disabled_count", "special_disabled_count", _
             "ordinary_disabled_count", "secondary_spouse_flag", _
             "secondary_specific_count", "secondary_elder_count", _
             "secondary_general_count", "secondary_special_relative_count", _
             "nonresident_relative_count"
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
        Case "spouse_tax_deduction": ColumnForField = "AG"
        Case "spouse_deduction_flag": ColumnForField = "AH"
        Case "elderly_spouse_flag": ColumnForField = "AI"
        Case "spouse_total_income": ColumnForField = "AJ"
        Case "specific_dependent_count": ColumnForField = "AK"
        Case "cohabiting_elder_count": ColumnForField = "AL"
        Case "elder_dependent_count": ColumnForField = "AM"
        Case "general_dependent_count": ColumnForField = "AN"
        Case "cohabiting_special_disabled_count": ColumnForField = "AO"
        Case "special_disabled_count": ColumnForField = "AP"
        Case "ordinary_disabled_count": ColumnForField = "AQ"
        Case "secondary_spouse_flag": ColumnForField = "AR"
        Case "secondary_specific_count": ColumnForField = "AS"
        Case "secondary_elder_count": ColumnForField = "AT"
        Case "secondary_general_count": ColumnForField = "AU"
        Case "secondary_special_relative_count": ColumnForField = "AV"
        Case "nonresident_relative_count": ColumnForField = "AW"
        ' basic_reference is supplemental and intentionally not auto-imported.
    End Select
End Function

Private Function ParseBatchBridge(ByVal path As String) As Collection
    Dim fso As Object, handle As Object, all As Collection, record As Object
    Dim line As String, pair As Variant, name As String, val As String
    Dim code As Long, pieces As Variant, word As Variant, i As Long
    Dim parseFailure As String
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
    parseFailure = Err.Description
    On Error Resume Next
    If Not handle Is Nothing Then handle.Close
    On Error GoTo 0
    Err.Raise vbObjectError + 917, "BatchWithholding", _
              "一括読取データの安全性検証に失敗しました。ファイルを再確認してください。"
End Function

' Return only tax-field names/Excel columns. Never echo raw source text.
Private Function MissingBatchFields(ByVal item As Object) As String
    Dim required As Variant, labels As Variant, idx As Long
    required = Array("salary_gross", "salary_reference", _
                     "deductions_reference", "income_tax_withheld", "social_insurance")
    labels = Array("支払金額(D列)", "給与所得控除後(K列)", _
                   "所得控除合計(L列)", "源泉徴収税額(M列)", "社会保険料等(N列)")
    For idx = LBound(required) To UBound(required)
        If Not item.Exists(CStr(required(idx))) Then
            If Len(MissingBatchFields) > 0 Then _
                MissingBatchFields = MissingBatchFields & "・"
            MissingBatchFields = MissingBatchFields & CStr(labels(idx))
        End If
    Next idx
End Function

' Called by both the regular local reader and the synthetic-only
' Excel COM test. Parsing always finishes before modifying a cell.
Private Sub PopulateBatchReview(ByVal all As Collection, ByVal ws As Worksheet)
    Dim idx As Long, rowNum As Long, item As Variant, col As String
    Dim record As Object, missingFields As String, warningCodes As String
    ' Reject malformed batch size even when invoked by another VBA macro.
    If all.Count < 1 Or all.Count > 20 Then _
        Err.Raise vbObjectError + 929, , "ページ数が不正です。"
    ' Only write after every block and every value has passed validation.
    ws.Range("A7:AX26").ClearContents
    For idx = 1 To all.Count
        Set record = all(idx)
        rowNum = START_ROW + idx - 1
        ws.Cells(rowNum, "A").Value2 = CLng(record("PAGE"))
        ' The slip year is immutable reference metadata, not the tax year.
        ' Use the operator-selected target year for tax calculations.
        If Len(CStr(record("YEAR"))) > 0 Then _
            ws.Cells(rowNum, "AX").Value2 = CLng(record("YEAR"))
        If NumericYen(ThisWorkbook.Worksheets(SHEET_HOME).Range("B4").Value2) Then _
            ws.Cells(rowNum, "C").Value2 = CLng(ThisWorkbook.Worksheets(SHEET_HOME).Range("B4").Value2)
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
        missingFields = MissingBatchFields(record)
        warningCodes = CStr(record("WARNINGS"))
        If NumericYen(ws.Cells(rowNum, "AX").Value2) And _
           NumericYen(ws.Cells(rowNum, "C").Value2) And _
           CLng(ws.Cells(rowNum, "AX").Value2) < CLng(ws.Cells(rowNum, "C").Value2) Then
            ws.Cells(rowNum, "G").Value2 = _
                "前年源泉票を参考に対象年を試算。給与・控除・扶養・住宅控除を対象年の見込額へ補正してください"
        ElseIf Len(missingFields) > 0 Then
            ws.Cells(rowNum, "G").Value2 = _
                "未読取：" & missingFields & "。原票照合後に値を入力し、確認してください"
        ElseIf InStr(1, warningCodes, "FAMILY_", vbBinaryCompare) > 0 Then
            ws.Cells(rowNum, "G").Value2 = _
                "配偶者・扶養等の人数/控除額は未転記です。住民税控除差の検証が必要なためHOLD"
        ElseIf InStr(1, warningCodes, "AMBIGUOUS_", vbBinaryCompare) > 0 Or _
               InStr(1, warningCodes, "CONFLICT_", vbBinaryCompare) > 0 Then
            ws.Cells(rowNum, "G").Value2 = _
                "項目の重複・矛盾：原票を確認してください。限度額はHOLD"
        ElseIf InStr(1, warningCodes, "MORTGAGE_", vbBinaryCompare) > 0 And _
               CStr(record("STATUS")) <> "READY_FOR_EXCEL_CROSSCHECK" Then
            ws.Cells(rowNum, "G").Value2 = _
                "住宅ローン控除の適用額・入居年等を単票画面で確認してください"
        ElseIf CStr(record("STATUS")) <> "READY_FOR_EXCEL_CROSSCHECK" Then
            ws.Cells(rowNum, "G").Value2 = _
                "読取要確認：原票の金額・年分・控除条件を照合してください"
        ElseIf record.Exists("mortgage_credit") Or _
               record.Exists("mortgage_possible_credit") Then
            ws.Cells(rowNum, "G").Value2 = _
                "住宅ローン控除は読取済・通常計算対象です。必要金額と源泉票外の所得・控除を確認してください"
        Else
            ws.Cells(rowNum, "G").Value2 = _
                "必要金額と源泉票外の所得・控除を個別確認してください"
        End If
    Next idx
End Sub

' No additional reader launch: multi-page PDFs selected from the normal
' source-import button are parsed once, then this validated ASCII bridge is
' transferred to the local review sheet. Never accepts arbitrary text fields.
Public Function BatchImportBridgeLocalFile(ByVal localBridge As String) As Boolean
    BatchImportBridgeLocalFile = ImportValidatedBridge(localBridge)
End Function

' Synthetic Windows Excel COM verification goes through the same path.
Public Function BatchImportBridgeForTest(ByVal localBridge As String) As Boolean
    BatchImportBridgeForTest = ImportValidatedBridge(localBridge)
End Function

Private Function ImportValidatedBridge(ByVal localBridge As String) As Boolean
    Dim ws As Worksheet, parsed As Collection
    On Error GoTo ImportFailed
    If mWorking Then Exit Function
    mWorking = True
    mLastBatchErrorCode = "NONE"
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then _
        Err.Raise vbObjectError + 918, , "保存可能なローカルブックが必要です。"
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    If Application.CountA(ws.Range("A7:A26")) > 0 Then _
        Err.Raise vbObjectError + 930, , "一括試算一覧は空欄が必要です。"
    Set parsed = ParseBatchBridge(localBridge)
    Call PopulateBatchReview(parsed, ws)
    ImportValidatedBridge = True
TestCleanup:
    mWorking = False
    Exit Function
ImportFailed:
    mLastBatchErrorCode = "BRIDGE_VALIDATION:" & CStr(Err.Number)
    If Not ws Is Nothing Then
        On Error Resume Next
        ws.Range("A7:AX26").ClearContents
    End If
    Resume TestCleanup
End Function

Public Sub BatchImport()
    Dim selected As Variant
    selected = Application.GetOpenFilename("PDF (*.pdf),*.pdf", 1, "複数人の源泉徴収票PDFを選択")
    If VarType(selected) = vbBoolean Then Exit Sub
    Call ImportBatchFile(CStr(selected), False)
End Sub

' Private on-device acceptance: the caller supplies a local PDF path to an
' isolated workbook copy. No input dialog and no raw figures in the return.
Public Function BatchImportLocalFile(ByVal pdfPath As String) As Boolean
    BatchImportLocalFile = ImportBatchFile(pdfPath, True)
End Function

Private Function ImportBatchFile(ByVal pdfPath As String, ByVal quiet As Boolean) As Boolean
    Dim selected As Variant, fso As Object, shell As Object, executable As String
    Dim outputJson As String, outputTsv As String, command As String, rc As Long
    Dim all As Collection, record As Object, ws As Worksheet
    Dim idx As Long, rowNum As Long, item As Variant, col As String
    Dim missingFields As String, warningCodes As String, importStage As String
    importStage = "PRECHECK"
    mLastBatchErrorCode = "NONE"
    On Error GoTo Failed
    If mWorking Then Exit Function
    selected = pdfPath
    If Len(Trim$(pdfPath)) = 0 Then _
        Err.Raise vbObjectError + 927, , "ローカルPDFを選択してください。"
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then _
        Err.Raise vbObjectError + 918, , "書き込み可能なローカルExcelブックが必要です。"
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    If Application.CountA(ws.Range("A7:A26")) > 0 Then _
        Err.Raise vbObjectError + 919, , "既存の一覧があります。保存後に「一覧初期化」で消去してください。"
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FileExists(CStr(selected)) Then _
        Err.Raise vbObjectError + 928, , "指定PDFが見つかりません。"
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
    importStage = "READER_EXE"
    rc = shell.Run(command, 0, True)
    If rc <> 0 Or Not fso.FileExists(outputTsv) Then _
        Err.Raise vbObjectError + 922, , "PDFのページ別読取に失敗しました。"
    importStage = "BRIDGE_PARSE"
    Set all = ParseBatchBridge(outputTsv)
    importStage = "ROW_TRANSFER"
    Call PopulateBatchReview(all, ws)
    ImportBatchFile = True
    If Not quiet Then
        MsgBox CStr(all.Count) & "ページを読み取り、対象者別の確認一覧を作成しました。" & vbCrLf & _
               "H列・I列を各人ごとに確認するまで寄附限度額は表示しません。", vbInformation
    End If
CleanUp:
    On Error Resume Next
    mWorking = False
    If Not fso Is Nothing Then
        If Len(outputJson) > 0 And fso.FileExists(outputJson) Then fso.DeleteFile outputJson, True
        If Len(outputTsv) > 0 And fso.FileExists(outputTsv) Then fso.DeleteFile outputTsv, True
    End If
    Exit Function
Failed:
    ImportBatchFile = False
    mLastBatchErrorCode = importStage & ":" & CStr(Err.Number)
    If importStage = "ROW_TRANSFER" Then
        On Error Resume Next
        If Not ws Is Nothing Then ws.Range("A7:AX26").ClearContents
    End If
    If Not quiet Then
        MsgBox "複数PDF取込に失敗しました（" & mLastBatchErrorCode & "）。" & vbCrLf & _
               "元のPDFは変更していません。", vbExclamation
    End If
    Resume CleanUp
End Function

Public Sub BatchClear()
    Dim previousEvents As Boolean
    If mWorking Then Exit Sub
    If MsgBox("現在の一括一覧を消去しますか？保存が必要な場合は先に案件保存してください。", _
              vbQuestion + vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    mWorking = True
    previousEvents = Application.EnableEvents
    On Error GoTo RestoreClearEvents
    Application.EnableEvents = False
    ThisWorkbook.Worksheets(SHEET_BATCH).Range("A7:AX26").ClearContents
RestoreClearEvents:
    Application.EnableEvents = previousEvents
    mWorking = False
End Sub

Private Function SnapshotInputs() As Object
    Dim data As Object, refs As Variant, addr As Variant, ws As Worksheet
    Dim n As Long
    Set data = CreateObject("Scripting.Dictionary")
    Set ws = ThisWorkbook.Worksheets(SHEET_HOME)
    For Each addr In Split("B4 B11 B12 B15 B16 B19 B20 B21 B22 B23 B24 B25 B33 B34 B35 B36 D24", " ")
        data.Add "H|" & CStr(addr), ws.Range(CStr(addr)).Formula
    Next addr
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
    Dim idx As Long, value As Variant, target As String
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
    ' Source family numbers reconcile to BOTH existing tax engines.
    ' Elder totals include cohabiting elders; special-disabled totals also
    ' include cohabiting members, so subtract the documented subtotals.
    home.Range("D11").Value2 = Val(CStr(ws.Cells(index, "AN").Value2))
    home.Range("D12").Value2 = Val(CStr(ws.Cells(index, "AL").Value2))
    home.Range("D13").Value2 = Val(CStr(ws.Cells(index, "AM").Value2)) - _
                               Val(CStr(ws.Cells(index, "AL").Value2))
    home.Range("D19").Value2 = Val(CStr(ws.Cells(index, "AQ").Value2))
    home.Range("D20").Value2 = Val(CStr(ws.Cells(index, "AP").Value2)) - _
                               Val(CStr(ws.Cells(index, "AO").Value2))
    home.Range("D21").Value2 = Val(CStr(ws.Cells(index, "AO").Value2))
    For idx = 0 To CLng(Val(CStr(ws.Cells(index, "AK").Value2))) - 1
        ' A qualifying 19-22-year-old with income in the dependent bracket
        ' maps to a 0-yen special-relative income in the existing tax table.
        home.Range("D" & CStr(14 + idx)).Value2 = 0
    Next idx
    If Val(CStr(ws.Cells(index, "AG").Value2)) > 0 Then
        If Val(CStr(ws.Cells(index, "AI").Value2)) = 1 Then
            target = "D18"
        Else
            target = "D17"
        End If
        ' For regular spouse deduction G09=1, the source tax deduction and
        ' elderly flag uniquely determine the equivalent ordinary deduction
        ' bracket. For spouse SPECIAL deduction, source spouse income G43
        ' is mandatory because resident thresholds may differ.
        If Val(CStr(ws.Cells(index, "AH").Value2)) = 1 Then
            ' Prefer the actual G43 spouse income when the slip supplies it.
            ' Only use the ordinary-deduction 0-yen representative if absent.
            If NumericYen(ws.Cells(index, "AJ").Value2) Then
                home.Range(target).Value2 = ws.Cells(index, "AJ").Value2
            Else
                home.Range(target).Value2 = 0
            End If
        Else
            home.Range(target).Value2 = ws.Cells(index, "AJ").Value2
        End If
    End If
    If Val(CStr(ws.Cells(index, "AK").Value2)) > 0 Then home.Range("B25").Value2 = "あり"
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

' A mortgage-related OCR warning does NOT permanently exclude a taxpayer.
' When the user manually reconciles the specific missing tax-slip field, the
' same pre-existing Excel housing-credit guards still decide eligibility.
' Multiple housing claims/unsupported pre-2022 cases NEVER auto-clear.
' An ordinary dependents/spouse claim is supported if its anonymized
' G-code fields are present and internally consistent. Never infer a missing
' checkbox, secondary claim, or nonresident status.
Private Function FamilyRowIssue(ByVal ws As Worksheet, ByVal index As Long) As String
    Dim applied As Variant, spouseFlag As Variant, elderFlag As Variant
    Dim secondaryFlag As Variant, spouseIncome As Variant, threshold As Long
    Dim numberCol As Variant, countVal As Variant
    spouseFlag = ws.Cells(index, "AH").Value2
    elderFlag = ws.Cells(index, "AI").Value2
    secondaryFlag = ws.Cells(index, "AR").Value2
    applied = ws.Cells(index, "AG").Value2
    spouseIncome = ws.Cells(index, "AJ").Value2
    If Not NumericYen(spouseFlag) Or Not NumericYen(elderFlag) Or _
       Not NumericYen(secondaryFlag) Then
        FamilyRowIssue = "配偶者の有無・老人区分の読取が不完全です"
        Exit Function
    End If
    If Not ((CLng(spouseFlag) = 1 Or CLng(spouseFlag) = 2) And _
           (CLng(elderFlag) = 1 Or CLng(elderFlag) = 2) And _
           (CLng(secondaryFlag) = 1 Or CLng(secondaryFlag) = 2)) Then
        FamilyRowIssue = "配偶者の有無・老人区分が不正です"
        Exit Function
    End If
    If Not NumericYen(applied) Then
        FamilyRowIssue = "源泉票の配偶者控除額が確認できません"
        Exit Function
    End If
    For Each numberCol In Split("AK AL AM AN AO AP AQ AS AT AU AV AW", " ")
        countVal = ws.Cells(index, CStr(numberCol)).Value2
        If Len(Trim$(CStr(countVal))) > 0 Then
            If Not NumericYen(countVal) Or CDbl(countVal) > 30 Then
                FamilyRowIssue = "扶養・障害者人数の読取が不正です"
                Exit Function
            End If
        End If
    Next numberCol
    If CLng(secondaryFlag) = 1 Or _
       Val(CStr(ws.Cells(index, "AS").Value2)) > 0 Or _
       Val(CStr(ws.Cells(index, "AT").Value2)) > 0 Or _
       Val(CStr(ws.Cells(index, "AU").Value2)) > 0 Or _
       Val(CStr(ws.Cells(index, "AV").Value2)) > 0 Or _
       Val(CStr(ws.Cells(index, "AW").Value2)) > 0 Then
        FamilyRowIssue = "従たる給与又は非居住者の扶養条件は個別確認が必要です"
        Exit Function
    End If
    If Val(CStr(ws.Cells(index, "AL").Value2)) > _
       Val(CStr(ws.Cells(index, "AM").Value2)) Or _
       Val(CStr(ws.Cells(index, "AO").Value2)) > _
       Val(CStr(ws.Cells(index, "AP").Value2)) Or _
       Val(CStr(ws.Cells(index, "AK").Value2)) > 3 Then
        FamilyRowIssue = "扶養・障害者の内訳が一致しません"
        Exit Function
    End If
    If CLng(spouseFlag) = 1 Then
        If CDbl(applied) = 0 Then
            FamilyRowIssue = "配偶者控除の適用有無と所得税控除額が矛盾しています"
            Exit Function
        End If
        If NumericYen(spouseIncome) Then
            threshold = IIf(CLng(ws.Cells(index, "C").Value2) = 2025, 580000, 620000)
            If CDbl(spouseIncome) > threshold Then
                FamilyRowIssue = "源泉控除対象配偶者の所得要件が一致しません"
                Exit Function
            End If
        End If
    ElseIf CDbl(applied) > 0 Then
        If Not NumericYen(spouseIncome) Then
            FamilyRowIssue = "配偶者特別控除は配偶者の合計所得を確認してください"
            Exit Function
        End If
        If CLng(elderFlag) = 1 Then
            FamilyRowIssue = "配偶者特別控除と老人配偶者の区分を確認してください"
            Exit Function
        End If
    ElseIf CLng(elderFlag) = 1 Then
        FamilyRowIssue = "配偶者控除がないのに老人配偶者の印が付いています"
    End If
End Function

Private Function ReviewWarningsSafe(ByVal status As String, ByVal warnings As String, _
                                    ByVal ws As Worksheet, ByVal index As Long) As Boolean
    Dim flag As Variant, applied As Variant, possible As Variant
    Dim occupied As Variant, claims As Variant, sourceYear As Variant
    Dim normalMortgage As Boolean
    If status = "READY_FOR_EXCEL_CROSSCHECK" Then
        ReviewWarningsSafe = True
        Exit Function
    End If
    If status <> "REQUIRES_REVIEW" Then Exit Function
    applied = ws.Cells(index, "Q").Value2
    possible = ws.Cells(index, "R").Value2
    occupied = ws.Cells(index, "S").Value2
    claims = ws.Cells(index, "T").Value2
    sourceYear = ws.Cells(index, "C").Value2
    normalMortgage = NumericYen(applied) And NumericYen(possible) And _
                    NumericYen(occupied) And NumericYen(claims)
    If normalMortgage Then
        normalMortgage = (CDbl(possible) > 0 And CDbl(applied) <= CDbl(possible) _
                          And CLng(occupied) >= 2022 And _
                          CLng(occupied) <= CLng(sourceYear) And _
                          CLng(claims) = 1)
    End If
    For Each flag In Split(warnings, ";")
        Select Case CStr(flag)
            Case "OCR_REQUIRES_VERIFICATION", "INCOMPLETE_OR_UNVERIFIED", _
                 "FAMILY_SPOUSE_INCOME_NEEDED"
                ' The two confirmation cells must already have been checked.
            Case "MORTGAGE_APPLIED_CREDIT_MISSING", _
                 "MORTGAGE_OCCUPANCY_YEAR_MISSING", _
                 "MORTGAGE_APPLIED_EXCEEDS_POSSIBLE", _
                 "INVALID_MORTGAGE_OCCUPANCY_YEAR"
                If Not normalMortgage Then Exit Function
            Case Else
                Exit Function
        End Select
    Next flag
    ReviewWarningsSafe = True
End Function

Public Sub BatchCalculate()
    Call ExecuteBatch(False)
End Sub

' Deterministic, nonmodal acceptance used only on the disposable Windows QA
' workbook. The exact same tax and HOLD flow drives the user-facing button.
Public Function BatchCalculateForTest() As Boolean
    BatchCalculateForTest = ExecuteBatch(True)
End Function

Private Function ExecuteBatch(ByVal noDialogs As Boolean, Optional ByVal onlyRow As Long = 0) As Boolean
    Dim ws As Worksheet, home As Worksheet, settings As Worksheet
    Dim cache As Object, initialEvents As Boolean, initialScreen As Boolean
    Dim index As Long, firstRow As Long, lastRow As Long
    Dim reason As String, amount As Variant, year As Long
    Dim sourceYear As Variant, referenceYear As Variant
    Dim header As Variant, good As Long, hold As Long
    Dim originalError As String, priorPageCount As Long
    If mWorking Then Exit Function
    initialEvents = Application.EnableEvents
    initialScreen = Application.ScreenUpdating
    On Error GoTo Failed
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    Set home = ThisWorkbook.Worksheets(SHEET_HOME)
    Set settings = ThisWorkbook.Worksheets("設定・税率")
    ' Initialize the fail-closed cleanup range BEFORE any preflight check.
    firstRow = START_ROW
    lastRow = END_ROW
    If onlyRow >= START_ROW And onlyRow <= END_ROW Then
        firstRow = onlyRow
        lastRow = onlyRow
    End If
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
    firstRow = START_ROW
    lastRow = END_ROW
    If onlyRow <> 0 Then
        If onlyRow < START_ROW Or onlyRow >= START_ROW + priorPageCount Then _
            Err.Raise vbObjectError + 931, , "指定行は取込一覧の対象外です。"
        firstRow = onlyRow
        lastRow = onlyRow
    End If
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
    For index = firstRow To lastRow
        If Len(Trim$(CStr(ws.Cells(index, "A").Value2))) = 0 Then Exit For
        ws.Cells(index, "E").ClearContents
        ws.Cells(index, "F").Value2 = "HOLD"
        reason = vbNullString
        ' Show a tax-year mismatch immediately even if confirmation is
        ' pending. Never silently rewrite C (income year) or the master year.
        If Not NumericYen(ws.Cells(index, "C").Value2) Then
            reason = "所得年を確認できません"
        ElseIf Not NumericYen(sourceYear) Then
            reason = "承認済み税制年を確認できません"
        ElseIf CLng(sourceYear) <> 2025 And CLng(sourceYear) <> 2026 Then
            reason = "未承認の税制年です"
        ElseIf CLng(ws.Cells(index, "C").Value2) <> CLng(sourceYear) Then
            reason = "承認済み税制年と試算対象年が異なります"
        ElseIf Not NumericYen(ws.Cells(index, "AX").Value2) Then
            reason = "原票の年分が不明です。PDFを再取込してください"
        ElseIf CLng(ws.Cells(index, "AX").Value2) < CLng(sourceYear) - 1 Or _
               CLng(ws.Cells(index, "AX").Value2) > CLng(sourceYear) Then
            reason = "原票年分が試算対象年の前年・当年ではありません"
        ElseIf ws.Cells(index, "H").Value2 <> "照合済" Or _
               ws.Cells(index, "I").Value2 <> "未対応条件なし" Then
            reason = "原票の金額・年分と未対応条件の確認待ち"
        ElseIf Len(FamilyRowIssue(ws, index)) > 0 Then
            reason = FamilyRowIssue(ws, index)
        ElseIf InStr(1, CStr(ws.Cells(index, "AF").Value2), "FAMILY_", vbBinaryCompare) > 0 _
               And InStr(1, CStr(ws.Cells(index, "AF").Value2), "FAMILY_SPOUSE_INCOME_NEEDED", vbBinaryCompare) = 0 Then
            reason = "源泉票の扶養・配偶者欄を安全に復元できません"
        ElseIf Not ReviewWarningsSafe(CStr(ws.Cells(index, "AE").Value2), _
                                           CStr(ws.Cells(index, "AF").Value2), ws, index) Then
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
                ' Compare the source's income-tax spouse deduction with
                ' the independently recalculated source-year tax-table value
                ' before trusting the resident-tax deduction differential.
                If Val(CStr(ws.Cells(index, "AG").Value2)) > 0 Then
                    If Val(CStr(ws.Cells(index, "AI").Value2)) = 1 Then
                        amount = ThisWorkbook.Worksheets("ふるさと納税限度額計算").Range("F37").Value2
                    Else
                        amount = ThisWorkbook.Worksheets("ふるさと納税限度額計算").Range("F36").Value2
                    End If
                    If Not NumericYen(amount) Then
                        reason = "配偶者控除の再計算ができません"
                    ElseIf CDbl(amount) <> CDbl(ws.Cells(index, "AG").Value2) Then
                        reason = "源泉票の配偶者控除額と税制表の再計算が一致しません"
                    End If
                End If
            End If
            If Len(reason) = 0 Then
                If CStr(home.Range("B28").Value2) <> "正常" Then
                    reason = CStr(home.Range("B28").Value2)
                Else
                    amount = home.Range("B8").Value2
                    If NumericYen(amount) Then
                        ws.Cells(index, "E").Value2 = CDbl(amount)
                        referenceYear = ws.Cells(index, "AX").Value2
                        If CLng(referenceYear) < CLng(sourceYear) Then
                            ws.Cells(index, "F").Value2 = "前年参考概算"
                            reason = "前年源泉票を参考にした対象年の見込額による概算（確定額ではありません）"
                        Else
                            ws.Cells(index, "F").Value2 = "概算"
                            reason = "既存計算エンジンによる概算（原票照合済）"
                        End If
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
    ExecuteBatch = True
    If Not noDialogs Then
        MsgBox "個別計算を終了しました。" & vbCrLf & "概算 " & good & "件 / HOLD " & hold & _
               "件。元の単票画面の入力は復元しました。", vbInformation
    End If
    Exit Function
Failed:
    originalError = Err.Description
    On Error Resume Next
    ' Abort is atomic as to published estimates: no partial results survive.
    If Not ws Is Nothing Then
        ws.Range("E7:E26").ClearContents
        For index = firstRow To lastRow
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
    ExecuteBatch = False
    If Not noDialogs Then
        MsgBox "一括試算を中断しました。元の入力は復元を試みました。" & vbCrLf & _
               "エラー: " & originalError, vbCritical
    End If
End Function

' Every edit invalidates the displayed estimate immediately.
' Numeric/source changes revoke earlier confirmation; confirming H/I or
' changing the filing method automatically reruns ONLY the affected row.
' Manually entered gross, salary-after-deduction, and total deductions are
' never replaced with computed values in the batch register.
Public Sub BatchInvalidate(ByVal changed As Range)
    Dim ws As Worksheet, touched As Range, cell As Range
    Dim changedRows As Object, taxRows As Object, rowKey As Variant
    Dim wasEnabled As Boolean, index As Long
    If mWorking Then Exit Sub
    Set ws = ThisWorkbook.Worksheets(SHEET_BATCH)
    Set touched = Application.Intersect(changed, ws.Range("A7:AX26"))
    If touched Is Nothing Then Exit Sub
    Set changedRows = CreateObject("Scripting.Dictionary")
    Set taxRows = CreateObject("Scripting.Dictionary")
    For Each cell In touched.Cells
        ' B is a non-calculation display label. Do not trigger recalc.
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
    ' Invalidate ALL edited rows before any row is recalculated. Pasted
    ' multi-row data cannot leave an older amount on a different row.
    For Each rowKey In changedRows.Keys
        index = CLng(changedRows(rowKey))
        ws.Cells(index, "E").ClearContents
        ws.Cells(index, "F").Value2 = "HOLD"
        ws.Cells(index, "G").Value2 = "入力変更後のため確認・自動再試算待ち"
        If taxRows.Exists(rowKey) Then
            ws.Cells(index, "H").Value2 = "未確認"
            ws.Cells(index, "I").Value2 = "未確認"
        End If
    Next rowKey
    ' Reuse exactly the same review gates, input snapshot, and calculation
    ' engine as the explicit batch button. No approval or year is inferred.
    For Each rowKey In changedRows.Keys
        index = CLng(changedRows(rowKey))
        If Len(Trim$(CStr(ws.Cells(index, "A").Value2))) > 0 Then
            Call ExecuteBatch(True, index)
        End If
    Next rowKey
RestoreEvents:
    Application.EnableEvents = wasEnabled
End Sub

' Called after the master/year changes successfully. Earlier estimates
' must never survive a tax revision or approved-income-year switch.
Public Function BatchMasterChanged() As Boolean
    Dim ws As Worksheet, ix As Long, priorEvents As Boolean
    If mWorking Then Exit Function
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
    BatchMasterChanged = True
ExitSafely:
    Application.EnableEvents = priorEvents
End Function

Public Sub BatchPrint()
    If mWorking Then Exit Sub
    ThisWorkbook.Worksheets(SHEET_BATCH).PrintPreview
End Sub
