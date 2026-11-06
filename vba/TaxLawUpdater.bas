Attribute VB_Name = "TaxLawUpdater"
Option Explicit

' Only isolated tests use this nonmodal diagnostic state.
Private mLastTestFailure As String

Private Const CATALOG_URL As String = "https://raw.githubusercontent.com/tanaka456jp/Furusato_nouzei/main/taxdata/catalog.tsv"
Private Const BUNDLED_REVISION As String = "2026-11-06-v4.13"

' User-facing command. The test entrypoint executes the very same transaction,
' but reports failures as exceptions instead of modal dialogs.
Public Sub TaxLawUpdate()
    Call ApplyApprovedYear(False)
End Sub

Public Function TaxLawUpdateForTest() As Boolean
    mLastTestFailure = vbNullString
    TaxLawUpdateForTest = ApplyApprovedYear(True)
End Function

Public Function TaxLawUpdateLastFailure() As String
    TaxLawUpdateLastFailure = mLastTestFailure
End Function

Private Function ApplyApprovedYear(ByVal noDialogs As Boolean) As Boolean
    Dim book As Workbook, home As Worksheet, settings As Worksheet
    Dim selectedYear As String, oldYear As Variant, oldRevision As Variant, oldStatus As Variant
    Dim backup As String, changed As Boolean, problem As String, restored As Boolean

    On Error GoTo Failed
    Set book = ThisWorkbook
    Set home = book.Worksheets("操作画面")
    Set settings = book.Worksheets("設定・税率")
    selectedYear = CStr(home.Range("B4").Value2)
    If selectedYear <> "2025" And selectedYear <> "2026" Then
        Err.Raise vbObjectError + 101, , "この版に収録された承認対象年は2025年と2026年です。"
    End If
    CheckCatalog selectedYear
    If book.ReadOnly Or Len(book.Path) = 0 Then
        Err.Raise vbObjectError + 102, , "書き込み可能なローカルのブックを開いてください。"
    End If

    oldYear = settings.Range("B4").Value2
    oldRevision = home.Range("B29").Value2
    oldStatus = home.Range("B30").Value2
    backup = UniqueBackupPath(book)
    book.SaveCopyAs backup
    If Len(Dir$(backup, vbNormal)) = 0 Then
        Err.Raise vbObjectError + 114, , "更新前のバックアップが作成されませんでした。"
    End If
    If FileLen(backup) = 0 Then
        Err.Raise vbObjectError + 115, , "更新前のバックアップが空です。"
    End If
    changed = True
    settings.Range("B4").Value2 = CLng(selectedYear)
    book.Worksheets("自動回帰テスト").Calculate
    book.Worksheets("整合性チェック").Calculate
    If CStr(book.Worksheets("自動回帰テスト").Range("B49").Value2) <> "PASS" Then
        Err.Raise vbObjectError + 103, , "内蔵回帰試験が不合格です。"
    End If
    If Application.CountIf(book.Worksheets("整合性チェック").Range("B4:B12"), "OK") <> 9 Then
        Err.Raise vbObjectError + 104, , "内蔵税制マスタに不整合があります。"
    End If
    home.Range("B29").Value2 = BUNDLED_REVISION
    home.Range("B30").Value2 = "適用済 " & Format$(Now, "yyyy/mm/dd hh:nn")
    Application.Calculate
    book.Save
    ApplyApprovedYear = True
    If Not noDialogs Then
        MsgBox selectedYear & "年分の承認済み税制を適用しました。" & vbCrLf & _
               "税制版：" & BUNDLED_REVISION, vbInformation, "税制更新完了"
    End If
    Exit Function

Failed:
    problem = Err.Description
    restored = Not changed
    On Error Resume Next
    If changed Then
        Err.Clear
        settings.Range("B4").Value2 = oldYear
        ' Restore the visible selection as well, so a failed update does not
        ' leave the calculator in an unexplained year-mismatch state.
        home.Range("B4").Value2 = oldYear
        home.Range("B29").Value2 = oldRevision
        home.Range("B30").Value2 = oldStatus
        If Err.Number = 0 Then
            Err.Clear
            Application.Calculate
            If Err.Number = 0 Then
                Err.Clear
                book.Save
                restored = (Err.Number = 0)
            End If
        End If
    End If
    On Error GoTo 0
    If changed Then
        problem = problem & vbCrLf & "更新前のバックアップ：" & backup
        If restored Then
            problem = problem & vbCrLf & "更新前の状態をブックに保存し直しました。"
        Else
            problem = problem & vbCrLf & "開いているブックを復元できませんでした。バックアップを使用してください。"
        End If
    End If
    If noDialogs Then
        ' An unhandled VBA Err.Raise can open a blocking Office/VBE modal
        ' dialog on unattended COM runners. Return False instead.
        mLastTestFailure = problem
        ApplyApprovedYear = False
        Exit Function
    End If
    MsgBox problem, vbExclamation, "税制更新を中止しました"
End Function

Private Sub CheckCatalog(ByVal selectedYear As String)
    Dim request As Object, line As Variant, fields As Variant
    Dim matches As Long, approved As Boolean
    Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
    request.SetTimeouts 5000, 5000, 10000, 12000
    request.Open "GET", CATALOG_URL, False
    request.Option(6) = False ' Disable redirects for the fixed catalog endpoint.
    request.Send
    If request.Status <> 200 Then Err.Raise vbObjectError + 105, , "GitHubの税制カタログを取得できません。"
    For Each line In Split(Replace(request.ResponseText, vbCr, ""), vbLf)
        If Len(Trim$(CStr(line))) > 0 Then
            fields = Split(CStr(line), "|")
            If CStr(fields(0)) = selectedYear Then
                matches = matches + 1
                If UBound(fields) = 4 Then
                    approved = fields(1) = "APPROVED" And fields(2) = BUNDLED_REVISION _
                        And Len(fields(3)) = 0 And Len(fields(4)) = 0
                End If
            End If
        End If
    Next line
    If matches <> 1 Or Not approved Then
        Err.Raise vbObjectError + 106, , "このブックに対応する承認済み内蔵版を確認できません。"
    End If
End Sub

Private Function UniqueBackupPath(ByVal book As Workbook) As String
    Dim fso As Object, folder As String, path As String, stem As String, serial As Long
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FolderExists(book.Path) Then Err.Raise vbObjectError + 107, , "ローカルの保存先を確認してください。"
    folder = fso.BuildPath(book.Path, "Furusato_backups")
    If Not fso.FolderExists(folder) Then fso.CreateFolder folder
    stem = fso.GetBaseName(book.Name) & "_" & Format$(Now, "yyyymmdd_hhnnss")
    Do
        serial = serial + 1
        path = fso.BuildPath(folder, stem & "_" & CStr(serial) & ".xlsm")
    Loop While fso.FileExists(path)
    UniqueBackupPath = path
End Function

' Bind each Forms button to the macro in THIS workbook.
' An unqualified OnAction can invoke a macro in another open client case;
' copied cases must rebind their own buttons when opened.
Private Sub BindButton(ByVal sheetName As String, ByVal buttonName As String, ByVal procedure As String)
    Dim target As Object
    Set target = ThisWorkbook.Worksheets(sheetName).Buttons(buttonName)
    target.OnAction = "'" & Replace(ThisWorkbook.Name, "'", "''") & "'!TaxLawUpdater." & procedure
End Sub

Public Sub BindButtons()
    BindButton "操作画面", "btnTaxLawUpdate", "TaxLawUpdate"
    BindButton "操作画面", "btnNewCase", "NewCase"
    BindButton "操作画面", "btnSaveCase", "SaveCase"
    BindButton "操作画面", "btnShowDetails", "ShowDetails"
    BindButton "操作画面", "btnRecalculateCase", "RecalculateCase"
    BindButton "操作画面", "btnShowAdvanced", "ShowAdvanced"
    BindButton "操作画面", "btnImportWithholding", "ImportWithholding"
    BindButton "例外・分離課税", "btnReturnFromAdvanced", "ReturnFromAdvanced"
    BindButton "計算根拠", "btnReturnHome", "ReturnHome"
    BindButton "計算根拠", "btnPrintDetails", "PrintDetails"
    BindButton "計算根拠", "btnExportDetails", "ExportDetails"
End Sub


' Import only allowlisted numeric fields from a local, explicitly selected file.
' Do not put names, addresses, tax IDs, or raw document text into the workbook.
' An immutable snapshot is saved before mutating a user's current input.
Public Sub ImportWithholding()
    Dim picked As Variant, fso As Object, shell As Object, reader As String
    Dim tempJson As String, tempTsv As String, command As String, line As String
    Dim inFile As Object, fields As Object, fragments As Variant
    Dim key As Variant, value As Double, year As Long, exitCode As Long
    Dim status As String, raw As String, backup As String
    Dim home As Worksheet, extra As Worksheet, code As Long, problem As String
    On Error GoTo Failed
    picked = Application.GetOpenFilename( _
        "源泉徴収票 (PDF/画像/データ),*.pdf;*.png;*.jpg;*.jpeg;*.webp;*.tif;*.tiff;*.bmp;*.heic;*.heif;*.csv;*.tsv;*.json;*.txt,すべてのファイル,*.*", _
        , "源泉徴収票を選択")
    If VarType(picked) = vbBoolean Then Exit Sub
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then
        Err.Raise vbObjectError + 201, , "書き込み可能なブックをローカルに保存してから取込んでください。"
    End If
    Set fso = CreateObject("Scripting.FileSystemObject")
    reader = fso.BuildPath(ThisWorkbook.Path, "FurusatoDocumentReader.exe")
    If Not fso.FileExists(reader) Then
        Err.Raise vbObjectError + 202, , "読取EXEがありません。Windows用配布ZIPをすべて展開してください。Pythonのインストールは不要です。"
    End If
    command = Chr$(34) & reader & Chr$(34)
    Set shell = CreateObject("WScript.Shell")
    tempJson = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName & ".json")
    tempTsv = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName & ".tsv")
    command = command & " --input " & Chr$(34) & CStr(picked) & Chr$(34) & _
              " --output " & Chr$(34) & tempJson & Chr$(34) & _
              " --bridge " & Chr$(34) & tempTsv & Chr$(34)
    exitCode = shell.Run(command, 0, True)
    If exitCode <> 0 Or Not fso.FileExists(tempTsv) Then
        Err.Raise vbObjectError + 203, , "源泉徴収票の読取に失敗しました。形式・OCR環境を確認してください。"
    End If
    Set fields = CreateObject("Scripting.Dictionary")
    Set inFile = fso.OpenTextFile(tempTsv, 1, False, 0) ' ASCII-only bridge: no PII
    Do Until inFile.AtEndOfStream
        line = inFile.ReadLine
        fragments = Split(line, vbTab)
        If UBound(fragments) <> 1 Then
            Err.Raise vbObjectError + 204, , "取込データが不正です。"
        End If
        If fields.Exists(CStr(fragments(0))) Then
            Err.Raise vbObjectError + 205, , "取込データ内に重複項目があります。"
        End If
        fields.Add CStr(fragments(0)), CStr(fragments(1))
    Loop
    inFile.Close
    Set inFile = Nothing
    If Not fields.Exists("STATUS") Or Not fields.Exists("YEAR") Then
        Err.Raise vbObjectError + 206, , "取込データの検証情報がありません。"
    End If
    status = CStr(fields("STATUS"))
    If status <> "READY_FOR_EXCEL_CROSSCHECK" Then
        Err.Raise vbObjectError + 207, , "未検証のOCR・様式・年分は自動転記しません。"
    End If
    If Not IsNumeric(fields("YEAR")) Then Err.Raise vbObjectError + 208, , "所得年を認識できません。"
    year = CLng(fields("YEAR"))
    If year <> 2025 And year <> 2026 Then Err.Raise vbObjectError + 209, , "未承認の年分です。"
    For Each key In Array("salary_gross", "income_tax_withheld", "social_insurance")
        If Not fields.Exists(CStr(key)) Then
            Err.Raise vbObjectError + 210, , "必須の支払金額・源泉税・社会保険料が読み取れていません。"
        End If
    Next key
    For Each key In fields.Keys
        If key <> "STATUS" And key <> "YEAR" Then
            raw = CStr(fields(key))
            If Len(raw) = 0 Or Not IsNumeric(raw) Then
                Err.Raise vbObjectError + 211, , "取込金額が不正です。"
            End If
            value = CDbl(raw)
            If value < 0 Or value > 1000000000000# Or value <> Fix(value) Then
                Err.Raise vbObjectError + 212, , "金額は非負整数で指定してください。"
            End If
            Select Case CStr(key)
                Case "salary_gross", "income_tax_withheld", "social_insurance", _
                     "life_new", "life_old", "medical_care", "annuity_new", _
                     "annuity_old", "earthquake_paid", "salary_reference", _
                     "deductions_reference", "life_deduction_reference", _
                     "earthquake_deduction_reference", "mortgage_credit", _
                     "mortgage_possible_credit", "mortgage_occupancy_year", _
                     "mortgage_claim_count", "basic_reference", "income_adjustment"
                    ' Allowed amounts only; all other columns are rejected.
                Case Else
                    Err.Raise vbObjectError + 213, , "未承認の取込項目を検出しました。"
            End Select
        End If
    Next key
    If MsgBox("源泉徴収票の数値を取込み、現在の入力を置換しますか？" & vbCrLf & _
              "既存データは更新前にバックアップします。", _
              vbQuestion + vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    backup = UniqueBackupPath(ThisWorkbook)
    ThisWorkbook.SaveCopyAs backup
    If Not fso.FileExists(backup) Then Err.Raise vbObjectError + 214, , "更新前のバックアップを作成できません。"
    Set home = ThisWorkbook.Worksheets("操作画面")
    Set extra = ThisWorkbook.Worksheets("例外・分離課税")
    home.Range("B11:B12,B15:B16,B19:B26,B33:B36,D11:D23").ClearContents
    extra.Range("B5:B21").ClearContents
    extra.Range("B4").Value2 = "通常"
    home.Range("D24").Value2 = "確定申告"
    home.Range("B4").Value2 = year
    home.Range("B11").Value2 = year
    For Each key In fields.Keys
        If key <> "STATUS" And key <> "YEAR" Then
            value = CDbl(fields(key))
            Select Case CStr(key)
                Case "salary_gross": home.Range("B12").Value2 = value
                Case "income_tax_withheld": home.Range("B15").Value2 = value
                Case "social_insurance": home.Range("B16").Value2 = value
                Case "life_new": home.Range("B19").Value2 = value
                Case "life_old": home.Range("B20").Value2 = value
                Case "annuity_new": home.Range("B21").Value2 = value
                Case "annuity_old": home.Range("B22").Value2 = value
                Case "medical_care": home.Range("B23").Value2 = value
                Case "earthquake_paid": home.Range("B24").Value2 = value
                Case "salary_reference": extra.Range("B15").Value2 = value
                Case "deductions_reference": extra.Range("B14").Value2 = value
                Case "life_deduction_reference": extra.Range("B16").Value2 = value
                Case "earthquake_deduction_reference": extra.Range("B17").Value2 = value
                Case "mortgage_credit": home.Range("B33").Value2 = value
                Case "mortgage_possible_credit": home.Range("B34").Value2 = value
                Case "mortgage_occupancy_year": home.Range("B35").Value2 = value
                Case "mortgage_claim_count": home.Range("B36").Value2 = value
                Case "income_adjustment": extra.Range("B13").Value2 = value
            End Select
        End If
    Next key
    ' Housing credit is a routine on-sheet input, not an advanced-case switch.
    ' The sheet formula still blocks missing applied amounts or unsupported years.
    extra.Range("B19").Value2 = "ローカル・項目コード照合"
    extra.Range("B20").Value2 = status
    Application.Calculate
    MsgBox "数値を取込みました。青色の未入力欄と原票の一致を確認してください。" & vbCrLf & _
           "住宅ローン控除は通常欄へ反映しました。不足項目や住民税残余枠の問題は安全停止します。", vbInformation
CleanUp:
    On Error Resume Next
    If Not inFile Is Nothing Then inFile.Close
    If Not fso Is Nothing Then
        If Len(tempTsv) > 0 Then If fso.FileExists(tempTsv) Then fso.DeleteFile tempTsv, True
        If Len(tempJson) > 0 Then If fso.FileExists(tempJson) Then fso.DeleteFile tempJson, True
    End If
    Exit Sub
Failed:
    problem = Err.Description
    MsgBox problem, vbExclamation, "源泉徴収票の取込"
    Resume CleanUp
End Sub

Public Sub RecalculateCase()
    Application.Calculate
End Sub

Public Sub NewCase()
    If MsgBox("現在の入力を消去しますか？保存が必要な場合は先に案件保存してください。", _
              vbQuestion + vbYesNo + vbDefaultButton2, "新規入力") <> vbYes Then Exit Sub
    With ThisWorkbook.Worksheets("操作画面")
        .Range("B11:B12,B15:B16,B19:B26,D11:D23").ClearContents
        .Range("D24").Value2 = "確定申告"
    End With
    With ThisWorkbook.Worksheets("例外・分離課税")
        .Range("B5:B18,B21,B33:B36").ClearContents
        .Range("B4").Value2 = "通常"
        .Range("B8").ClearContents
        .Range("B19:B20").ClearContents
    End With
    Application.Calculate
End Sub

' Save-copy core is shared between the UI and an isolated Windows acceptance test.
' Never overwrite an existing customer case, including a previous test run.
' Write into the SAME destination folder, verify it, and then rename.
' A failed Excel SaveCopyAs must never leave a half-written customer case.
Public Function SaveCaseToFile(ByVal destination As String) As Boolean
    Dim fso As Object, folder As String, temporary As String
    Dim i As Long, problem As String, errorCode As Long
    On Error GoTo Failed
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Len(Trim$(destination)) = 0 Or LCase$(Right$(destination, 5)) <> ".xlsm" Then
        Err.Raise vbObjectError + 108, , ".xlsmの拡張子で保存してください。"
    End If
    If fso.FileExists(destination) Then
        Err.Raise vbObjectError + 109, , "同名ファイルがあります。別の名前で保存してください。"
    End If
    folder = fso.GetParentFolderName(fso.GetAbsolutePathName(destination))
    If Not fso.FolderExists(folder) Then
        Err.Raise vbObjectError + 119, , "案件保存先のフォルダが見つかりません。"
    End If
    For i = 1 To 1000
        temporary = fso.BuildPath(folder, "_furusato_case_" & _
                        Format$(Now, "yyyymmdd_hhnnss") & "_" & CStr(i) & ".xlsm")
        If Not fso.FileExists(temporary) Then Exit For
    Next i
    If i > 1000 Then
        Err.Raise vbObjectError + 120, , "案件保存用の一時ファイル名を確保できません。"
    End If
    Application.Calculate
    ThisWorkbook.SaveCopyAs temporary
    If Not fso.FileExists(temporary) Then
        Err.Raise vbObjectError + 117, , "一時案件ファイルの保存を確認できません。"
    End If
    If fso.GetFile(temporary).Size < 20000 Then
        Err.Raise vbObjectError + 118, , "一時案件ファイルのサイズが不正です。"
    End If
    ' MoveFile refuses an existing destination; it does not overwrite the file.
    fso.MoveFile temporary, destination
    SaveCaseToFile = True
    Exit Function

Failed:
    errorCode = Err.Number
    problem = Err.Description
    On Error Resume Next
    If Not fso Is Nothing Then
        If Len(temporary) > 0 Then
            If fso.FileExists(temporary) Then fso.DeleteFile temporary, True
        End If
    End If
    On Error GoTo 0
    Err.Raise errorCode, "TaxLawUpdater.SaveCaseToFile", problem
End Function

Public Sub SaveCase()
    Dim destination As Variant
    On Error GoTo Failed
    destination = Application.GetSaveAsFilename(InitialFileName:="Furusato_case.xlsm", _
                    FileFilter:="Excel Macro-Enabled Workbook (*.xlsm),*.xlsm")
    If VarType(destination) = vbBoolean Then Exit Sub
    If SaveCaseToFile(CStr(destination)) Then
        MsgBox "案件を保存しました。再編集するときは保存したファイルをExcelで開いてください。", vbInformation
    End If
    Exit Sub
Failed:
    MsgBox Err.Description, vbExclamation, "案件の保存"
End Sub

Public Sub ShowAdvanced()
    With ThisWorkbook.Worksheets("例外・分離課税")
        .Visible = xlSheetVisible
        .Activate
    End With
End Sub

Public Sub ReturnFromAdvanced()
    ThisWorkbook.Worksheets("操作画面").Activate
    ThisWorkbook.Worksheets("例外・分離課税").Visible = xlSheetVeryHidden
End Sub

Public Sub ShowDetails()
    With ThisWorkbook.Worksheets("計算根拠")
        .Visible = xlSheetVisible
        .Activate
    End With
End Sub

Public Sub ReturnHome()
    ThisWorkbook.Worksheets("操作画面").Activate
    ThisWorkbook.Worksheets("計算根拠").Visible = xlSheetVeryHidden
End Sub

Public Sub PrintDetails()
    On Error GoTo Failed
    Application.Calculate
    If CStr(ThisWorkbook.Worksheets("操作画面").Range("B28").Value2) <> "正常" Then
        Err.Raise vbObjectError + 110, , "入力と計算状態を確認してください。"
    End If
    ShowDetails
    ThisWorkbook.Worksheets("計算根拠").PrintPreview
    Exit Sub
Failed:
    MsgBox Err.Description, vbExclamation, "印刷"
End Sub

' PDF export is verified and staged exactly like case saving.
' The test calls this public entrypoint, not Excel's sheet export directly.
Public Function ExportDetailsToFile(ByVal destination As String) As Boolean
    Dim fso As Object, folder As String, temporary As String
    Dim i As Long, code As Long, problem As String, openedDetail As Boolean
    On Error GoTo Failed
    Application.Calculate
    If CStr(ThisWorkbook.Worksheets("操作画面").Range("B28").Value2) <> "正常" Then
        Err.Raise vbObjectError + 111, , "入力と計算状態を確認してください。"
    End If
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Len(Trim$(destination)) = 0 Or LCase$(Right$(destination, 4)) <> ".pdf" Then
        Err.Raise vbObjectError + 112, , ".pdfの拡張子で保存してください。"
    End If
    If fso.FileExists(destination) Then
        Err.Raise vbObjectError + 113, , "同名のPDFがあります。別の名前を指定してください。"
    End If
    folder = fso.GetParentFolderName(fso.GetAbsolutePathName(destination))
    If Not fso.FolderExists(folder) Then
        Err.Raise vbObjectError + 121, , "PDF保存先のフォルダが見つかりません。"
    End If
    For i = 1 To 1000
        temporary = fso.BuildPath(folder, "_furusato_pdf_" & _
                       Format$(Now, "yyyymmdd_hhnnss") & "_" & CStr(i) & ".pdf")
        If Not fso.FileExists(temporary) Then Exit For
    Next i
    If i > 1000 Then
        Err.Raise vbObjectError + 122, , "PDF用一時ファイル名を確保できません。"
    End If
    If ThisWorkbook.Worksheets("計算根拠").Visible <> xlSheetVisible Then
        ShowDetails
        openedDetail = True
    End If
    ThisWorkbook.Worksheets("計算根拠").ExportAsFixedFormat _
        Type:=xlTypePDF, Filename:=temporary
    If Not fso.FileExists(temporary) Then
        Err.Raise vbObjectError + 123, , "PDFの作成を確認できません。"
    End If
    If fso.GetFile(temporary).Size < 500 Then
        Err.Raise vbObjectError + 124, , "生成されたPDFのサイズが不正です。"
    End If
    fso.MoveFile temporary, destination
    If openedDetail Then ReturnHome
    ExportDetailsToFile = True
    Exit Function
Failed:
    code = Err.Number
    problem = Err.Description
    On Error Resume Next
    If Not fso Is Nothing Then
        If Len(temporary) > 0 Then
            If fso.FileExists(temporary) Then fso.DeleteFile temporary, True
        End If
    End If
    If openedDetail Then ReturnHome
    On Error GoTo 0
    Err.Raise code, "TaxLawUpdater.ExportDetailsToFile", problem
End Function

Public Sub ExportDetails()
    Dim destination As Variant
    On Error GoTo Failed
    Application.Calculate
    If CStr(ThisWorkbook.Worksheets("操作画面").Range("B28").Value2) <> "正常" Then
        Err.Raise vbObjectError + 111, , "入力と計算状態を確認してください。"
    End If
    destination = Application.GetSaveAsFilename(InitialFileName:="Furusato_result.pdf", _
                   FileFilter:="PDF (*.pdf),*.pdf")
    If VarType(destination) = vbBoolean Then Exit Sub
    If ExportDetailsToFile(CStr(destination)) Then
        MsgBox "計算結果のPDFを保存しました。", vbInformation, "PDF出力完了"
    End If
    Exit Sub
Failed:
    MsgBox Err.Description, vbExclamation, "PDF出力"
End Sub

' Nonmodal COM acceptance adapters for expected *refusal* paths only.
' User-facing procedures still report failures through their normal handlers.
Public Function TrySaveCaseToFileForTest(ByVal destination As String) As Boolean
    On Error GoTo Refused
    TrySaveCaseToFileForTest = SaveCaseToFile(destination)
    Exit Function
Refused:
    TrySaveCaseToFileForTest = False
End Function

Public Function TryExportDetailsToFileForTest(ByVal destination As String) As Boolean
    On Error GoTo Refused
    TryExportDetailsToFileForTest = ExportDetailsToFile(destination)
    Exit Function
Refused:
    TryExportDetailsToFileForTest = False
End Function
