Attribute VB_Name = "TaxLawUpdater"
Option Explicit

' Only isolated tests use this nonmodal diagnostic state.
Private mLastTestFailure As String
Private mResultUnverified As Boolean
' Numeric-only diagnostic for isolated PC1 tests. Never records name/text/paths.
Private mBatchLastInnerError As Long
' Diagnostic-only numeric state. No taxpayer inputs, paths or names are stored.
Private mBatchRecalcLastStage As Long
Private mBatchRecalcLastError As Long
Private mBatchRecalcLastExitCode As Long
Private mBatchRecalcLastLaunchAttempts As Long
' Default source import is source-only, unverified, zero-confirmation preview.
Private mManualImport As Boolean
Private mResultMaskBusy As Boolean
Private mSavedResultFormats As Object
Private Const CATALOG_URL As String = "https://raw.githubusercontent.com/tanaka456jp/Furusato_nouzei/main/taxdata/catalog.tsv"
Private Const BUNDLED_REVISION As String = "2026-11-05-bundled"

' Isolated QA only: record coarse stages, never taxpayer data, IDs, URLs or tokens.
' The forensic trace is kept beside the disposable test workbook and is not
' produced by the normal TaxLawUpdate user command.
Private Sub RecordTestUpdateStage(ByVal stage As String)
    Dim fileNumber As Integer
    If Len(ThisWorkbook.Path) = 0 Then Exit Sub
    On Error Resume Next
    fileNumber = FreeFile
    Open ThisWorkbook.Path & Application.PathSeparator & _
        "_furusato_tax_update_qa.trace" For Append As #fileNumber
    Print #fileNumber, stage
    Close #fileNumber
    On Error GoTo 0
End Sub


' Fail closed if Excel keeps a cached amount/status while recalculation is pending.
' Masking is visual (formulas are retained), and print/PDF entrypoints also
' independently require trusted, completed, automatic calculation.

' Diagnostic-only trace for the build-time disposable XLSM. Never writes when
' customers use a saved workbook, and never records cell contents or credentials.
Private Sub TraceBuildMaskStage(ByVal stage As String)
    Dim f As Integer
    If Left$(ThisWorkbook.Name, Len("_furusato_build_")) <> "_furusato_build_" Then Exit Sub
    On Error Resume Next
    f = FreeFile
    Open ThisWorkbook.Path & Application.PathSeparator & _
        "_furusato_mask_qa.trace" For Append As #f
    Print #f, stage
    Close #f
    On Error GoTo 0
End Sub

Private Function OutputAreas() As Variant
    OutputAreas = Array("B8", "D8", "B26", "B55", "B56", "D56", _
        "B58:D64", "B65", "D65", "B66", "D66", "B68", "D68", _
        "B69", "D69", "B81:B86", "D81:D86")
End Function

Private Function OriginalResultFormat(ByVal address As String) As String
    Select Case address
        Case "B26", "B55"
            OriginalResultFormat = "General"
        Case "D68"
            OriginalResultFormat = "0.000%"
        Case Else
            OriginalResultFormat = "#,##0"
    End Select
End Function

Public Sub MaskUnverifiedResults()
    Dim home As Worksheet, address As Variant, oldEvents As Boolean
    Dim original As String, problem As String
    If mResultMaskBusy Then Exit Sub
    mResultMaskBusy = True
    mResultUnverified = True
    TraceBuildMaskStage "entered"
    oldEvents = Application.EnableEvents
    On Error GoTo Failed
    Application.EnableEvents = False
    Set home = ThisWorkbook.Worksheets("操作画面")
    TraceBuildMaskStage "sheet"
    If mSavedResultFormats Is Nothing Then Set mSavedResultFormats = CreateObject("Scripting.Dictionary")
    TraceBuildMaskStage "dictionary"
    For Each address In OutputAreas()
        TraceBuildMaskStage "before:" & CStr(address)
        If Not mSavedResultFormats.Exists(CStr(address)) Then
            original = CStr(home.Range(CStr(address)).NumberFormat)
            If original = ";;;" Then original = OriginalResultFormat(CStr(address))
            mSavedResultFormats.Add CStr(address), original
        End If
        home.Range(CStr(address)).NumberFormat = ";;;"
        TraceBuildMaskStage "after:" & CStr(address)
    Next address
    TraceBuildMaskStage "before-status"
    home.Range("A9").Value2 = "計算未完了：旧結果を非表示にしました。自動計算に戻して「計算」を実行してください。"
    TraceBuildMaskStage "after-status"
    Application.EnableEvents = oldEvents
    mResultMaskBusy = False
    Exit Sub
Failed:
    problem = Err.Description
    Application.EnableEvents = oldEvents
    mResultMaskBusy = False
    Err.Raise vbObjectError + 301, "TaxLawUpdater.MaskUnverifiedResults", problem
End Sub

Public Sub RevealVerifiedResults()
    Dim home As Worksheet, address As Variant, oldEvents As Boolean
    If Not mResultUnverified Or mResultMaskBusy Then Exit Sub
    ' Manual mode may retain xlPending and old formula caches. Never reveal.
    If Application.Calculation <> xlCalculationAutomatic Then Exit Sub
    If Application.CalculationState <> xlDone Then Exit Sub
    mResultMaskBusy = True
    oldEvents = Application.EnableEvents
    On Error GoTo Failed
    Application.EnableEvents = False
    Set home = ThisWorkbook.Worksheets("操作画面")
    For Each address In OutputAreas()
        If Not mSavedResultFormats Is Nothing Then
            If mSavedResultFormats.Exists(CStr(address)) Then
                home.Range(CStr(address)).NumberFormat = mSavedResultFormats(CStr(address))
            Else
                home.Range(CStr(address)).NumberFormat = OriginalResultFormat(CStr(address))
            End If
        Else
            home.Range(CStr(address)).NumberFormat = OriginalResultFormat(CStr(address))
        End If
    Next address
    ' Preserve the source-only caveat after showing masked results.
    home.Range("A9").Formula = "=F9"
    mResultUnverified = False
    Application.EnableEvents = oldEvents
    mResultMaskBusy = False
    Exit Sub
Failed:
    Application.EnableEvents = oldEvents
    mResultMaskBusy = False
    Err.Raise vbObjectError + 302, "TaxLawUpdater.RevealVerifiedResults", _
        "計算結果の表示を復旧できません。ブックを閉じずに安全確認してください。"
End Sub

Public Function ResultsAreCurrent() As Boolean
    ResultsAreCurrent = (Not mResultUnverified) And _
        Application.Calculation = xlCalculationAutomatic And _
        Application.CalculationState = xlDone
End Function



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
    If noDialogs Then RecordTestUpdateStage "catalog-start"
    CheckCatalog selectedYear
    If noDialogs Then RecordTestUpdateStage "catalog-pass"
    If book.ReadOnly Or Len(book.Path) = 0 Then
        Err.Raise vbObjectError + 102, , "書き込み可能なローカルのブックを開いてください。"
    End If

    oldYear = settings.Range("B4").Value2
    oldRevision = home.Range("B29").Value2
    oldStatus = home.Range("B30").Value2
    If noDialogs Then RecordTestUpdateStage "backup-start"
    backup = UniqueBackupPath(book)
    book.SaveCopyAs backup
    If noDialogs Then RecordTestUpdateStage "backup-pass"
    If Len(Dir$(backup, vbNormal)) = 0 Then
        Err.Raise vbObjectError + 114, , "更新前のバックアップが作成されませんでした。"
    End If
    If FileLen(backup) = 0 Then
        Err.Raise vbObjectError + 115, , "更新前のバックアップが空です。"
    End If
    changed = True
    If noDialogs Then RecordTestUpdateStage "year-apply-start"
    settings.Range("B4").Value2 = CLng(selectedYear)
    book.Worksheets("自動回帰テスト").Calculate
    book.Worksheets("整合性チェック").Calculate
    If CStr(book.Worksheets("自動回帰テスト").Range("B49").Value2) <> "PASS" Then
        Err.Raise vbObjectError + 103, , "内蔵回帰試験が不合格です。"
    End If
    If Application.CountIf(book.Worksheets("整合性チェック").Range("B4:B12"), "OK") <> 9 Then
        Err.Raise vbObjectError + 104, , "内蔵税制マスタに不整合があります。"
    End If
    If noDialogs Then RecordTestUpdateStage "regression-pass"
    home.Range("B29").Value2 = BUNDLED_REVISION
    home.Range("B30").Value2 = "適用済 " & Format$(Now, "yyyy/mm/dd hh:nn")
    If noDialogs Then RecordTestUpdateStage "calculate-start"
    Application.Calculate
    If noDialogs Then RecordTestUpdateStage "calculate-pass"
    book.Save
    If noDialogs Then RecordTestUpdateStage "saved-pass"
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
    BindButton "操作画面", "btnReviewWithholding", "ReviewWithholding"
    BindButton "操作画面", "btnImportWithholdingBatch", "ImportWithholdingBatch"
    BindButton "一括計算一覧", "btnClearBatchOverviewWithConfirm", "ClearBatchOverviewWithConfirm"
    BindButton "一括計算一覧", "btnExportAllBatchReferencePDFs", "ExportAllBatchReferencePDFs"
    BindButton "一括入力修正", "btnRecalculateBatchEdits", "RecalculateBatchFromEditor"
    BindButton "例外・分離課税", "btnReturnFromAdvanced", "ReturnFromAdvanced"
    BindButton "計算根拠", "btnReturnHome", "ReturnHome"
    BindButton "計算根拠", "btnPrintDetails", "PrintDetails"
    BindButton "計算根拠", "btnExportDetails", "ExportDetails"
End Sub


' Distinct salary-only bulk workflow.  One source PDF page becomes ONE
' overview row, never the current single-taxpayer model.  Advanced income,
' split taxation, housing and ambiguous statutory conditions remain HOLD.
' Bulk list contains figures from unrelated taxpayers; never leak it into a
' single-taxpayer case. SaveCaseToFile refuses while this overview is populated.
' NewCase discards it only with the user's explicit existing confirmation.
Private Function BatchOverviewHasRecords() As Boolean
    BatchOverviewHasRecords = _
        (Application.WorksheetFunction.CountA( _
            ThisWorkbook.Worksheets("一括計算一覧").Range("B6:B105")) > 0)
End Function

Public Sub ClearBatchOverview()
    With ThisWorkbook.Worksheets("一括計算一覧")
        .Unprotect
        .Range("A6:V105").ClearContents
        .Rows("6:105").RowHeight = 21
        .Protect AllowFiltering:=True, UserInterfaceOnly:=True
    End With
    ThisWorkbook.Worksheets("一括入力修正").Range("A6:AI105").ClearContents
    ' Do not leave the final exported taxpayer in the hidden report sheet
    ' after clearing/saving another case.
    With ThisWorkbook.Worksheets("自動試算根拠")
        .Range("B3:B19").ClearContents
        .Range("B20:D23").ClearContents
        .Visible = xlSheetVeryHidden
    End With
End Sub

Public Sub ClearBatchOverviewWithConfirm()
    If Not BatchOverviewHasRecords() Then Exit Sub
    If MsgBox("複数人一覧の読取結果をすべて消去しますか？", _
              vbQuestion + vbYesNo + vbDefaultButton2, _
              "複数人一覧の消去") <> vbYes Then Exit Sub
    ClearBatchOverview
    MsgBox "複数人一覧を消去しました。", vbInformation, "複数人一覧"
End Sub

Public Sub ImportWithholdingBatch()
    Dim selected As Variant, fso As Object, shell As Object
    Dim reader As String, temporary As String, command As String
    Dim exitCode As Long, records As Long, problem As String
    On Error GoTo Failed
    selected = Application.GetOpenFilename( _
        "PDF (*.pdf),*.pdf", 1, "複数人の源泉徴収票PDFを選択")
    If VarType(selected) = vbBoolean Then Exit Sub
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then
        Err.Raise vbObjectError + 341, , _
            "書き込み可能なローカルのExcelブックを開いてください。"
    End If
    Set fso = CreateObject("Scripting.FileSystemObject")
    reader = fso.BuildPath(ThisWorkbook.Path, "FurusatoDocumentReader.exe")
    If Not fso.FileExists(reader) Then
        Err.Raise vbObjectError + 342, , _
            "読取EXEがありません。修正版配布ZIPを完全に展開してください。"
    End If
    temporary = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName & ".tsv")
    command = Chr$(34) & reader & Chr$(34) & _
              " --input " & Chr$(34) & CStr(selected) & Chr$(34) & _
              " --output " & Chr$(34) & temporary & Chr$(34) & _
              " --batch-bridge --batch-target-year " & _
              CStr(CLng(ThisWorkbook.Worksheets("操作画面").Range("B4").Value2))
    Set shell = CreateObject("WScript.Shell")
    exitCode = shell.Run(command, 0, True)
    If exitCode <> 0 Or Not fso.FileExists(temporary) Then
        Err.Raise vbObjectError + 343, , _
            "複数ページPDFの一括読取に失敗しました。元の入力は変更していません。"
    End If
    records = LoadBatchFromTsv(temporary)
    MsgBox CStr(records) & "ページの給与所得限定・参考一覧を作成しました。" & _
           vbCrLf & "限度額が保留の行は、単独計算で詳細確認してください。" & _
           vbCrLf & "現在の単独案件の数値は変更していません。", _
           vbInformation, "複数人一覧"
CleanUp:
    On Error Resume Next
    If Not fso Is Nothing Then
        If Len(temporary) > 0 Then
            If fso.FileExists(temporary) Then fso.DeleteFile temporary, True
        End If
    End If
    Exit Sub
Failed:
    problem = Err.Description
    MsgBox problem, vbExclamation, "複数人一覧の取込"
    Resume CleanUp
End Sub



' Strict uppercase UTF-16 BMP name transport; never execute text as formula.
Private Function DecodeRecipientNameForBatch(ByVal encoded As String) As String
    Dim i As Long, cp As Long, candidate As String
    If encoded = "" Then
        DecodeRecipientNameForBatch = "氏名未判読"
        Exit Function
    End If
    If Len(encoded) > 160 Or Len(encoded) Mod 4 <> 0 Or _
       encoded Like "*[!0-9A-F]*" Then _
       Err.Raise vbObjectError + 402, , "受給者氏名符号が不正です。"
    For i = 1 To Len(encoded) Step 4
        cp = CLng("&H0" & Mid$(encoded, i, 4))
        If Not ((cp >= 13312 And cp <= 40959) Or _
                (cp >= &H3040 And cp <= &H30FF) Or _
                (cp >= &H41 And cp <= &H5A) Or _
                (cp >= &H61 And cp <= &H7A) Or _
                (cp >= &HC0 And cp <= &H24F) Or _
                cp = &H3005 Or cp = &H3006 Or cp = &H30FB Or _
                cp = &HB7 Or cp = &H20 Or cp = &H2D) Then _
                Err.Raise vbObjectError + 403, , "受給者氏名に不正文字があります。"
        candidate = candidate & ChrW$(cp)
    Next i
    If Len(Trim$(candidate)) = 0 Or Left$(candidate, 1) = "-" Then _
        Err.Raise vbObjectError + 404, , "受給者氏名が不正です。"
    DecodeRecipientNameForBatch = candidate
End Function

' This report is the separate, explicitly unverified batch preview and is
' never an alias for verified "計算根拠" or its strict CheckReportAvailable.
Private Sub PopulateBatchReferenceSheet(ByVal index As Long, _
                                        ByVal source As Worksheet, _
                                        ByVal report As Worksheet)
    Dim status As String, rowNo As Long, ratioPpm As Double
    rowNo = index + 5
    status = CStr(source.Cells(rowNo, 10).Value2)
    If status <> "参考額（仮）" And status <> "HOLD／要確認" Then _
        Err.Raise vbObjectError + 390, , "一覧の判定が不正です。"
    report.Range("B3:B19").ClearContents
    report.Range("B20:D23").ClearContents
    report.Range("B3").Value2 = source.Cells(rowNo, 1).Value2
    report.Range("B4").Value2 = CDbl(source.Cells(rowNo, 2).Value2)
    report.Range("B5").Value2 = source.Cells(rowNo, 3).Value2
    report.Range("B7").Value2 = source.Cells(rowNo, 4).Value2
    report.Range("B8").Value2 = source.Cells(rowNo, 5).Value2
    report.Range("B9").Value2 = source.Cells(rowNo, 6).Value2
    report.Range("B10").Value2 = source.Cells(rowNo, 8).Value2
    report.Range("B11").Value2 = source.Cells(rowNo, 7).Value2
    report.Range("B21").Value2 = status
    If status = "HOLD／要確認" Then
        report.Range("B19").ClearContents
        report.Range("B22").Value2 = "必須数値・原票の検証不足により計算保留"
        report.Range("B23").Value2 = CStr(source.Cells(rowNo, 11).Value2)
    Else
        ' Legacy 10-column batches have no model trace. Fail closed and
        ' request a fresh import rather than inventing marginal tax rates.
        If Len(CStr(source.Cells(rowNo, 12).Value2)) = 0 Then _
            Err.Raise vbObjectError + 391, , _
              "この一覧に計算根拠の数値がありません。源泉票を再取込してください。"
        If Len(CStr(source.Cells(rowNo, 19).Value2)) = 0 Then _
            Err.Raise vbObjectError + 392, , "自治体モデルの根拠がありません。"
        report.Range("B6").Value2 = source.Cells(rowNo, 12).Value2
        report.Range("B12").Value2 = source.Cells(rowNo, 13).Value2
        report.Range("B13").Value2 = source.Cells(rowNo, 14).Value2
        report.Range("B14").Value2 = source.Cells(rowNo, 15).Value2
        report.Range("B15").Value2 = source.Cells(rowNo, 16).Value2
        ratioPpm = CDbl(source.Cells(rowNo, 17).Value2)
        If ratioPpm > 0 Then
            report.Range("B16").Value2 = 0.9 - ratioPpm / 1000000#
            report.Range("B17").Value2 = ratioPpm / 1000000#
        End If
        report.Range("B18").Value2 = source.Cells(rowNo, 18).Value2
        report.Range("B19").Value2 = source.Cells(rowNo, 9).Value2
        report.Range("B20").Value2 = source.Cells(rowNo, 19).Value2
        report.Range("B22").Value2 = "住民税所得割×20%が特例控除の上限"
        report.Range("B23").Value2 = "ワンストップ：" & _
            Format$(CDbl(source.Cells(rowNo, 9).Value2), "#,##0") & _
            "円／確定申告・自己負担2千円以内：" & _
            IIf(Len(CStr(source.Cells(rowNo, 20).Value2)) = 0, _
                "要確認", _
                Format$(Val(CStr(source.Cells(rowNo, 20).Value2)), "#,##0") & "円")
        If IsNumeric(source.Cells(rowNo, 21).Value2) And _
           IsNumeric(source.Cells(rowNo, 22).Value2) Then
            report.Range("B23").Value2 = CStr(report.Range("B23").Value2) & _
                "／" & Format$(CDbl(source.Cells(rowNo, 21).Value2), "#,##0") & _
                "円寄附を確定申告した場合の実質負担（仮）：" & _
                Format$(CDbl(source.Cells(rowNo, 22).Value2), "#,##0") & "円"
        End If

    End If
End Sub

' No popups: also called by the isolated PC1 Windows Excel acceptance test.
' Every page becomes its OWN file. A full report set is committed only after
' all PDFs have been generated and checked in a temporary sibling folder.
Public Function ExportAllBatchReferencePDFsToFolder( _
        ByVal parentFolder As String) As Long
    Dim fso As Object, batch As Worksheet, report As Worksheet
    Dim staging As String, outputFolder As String, candidate As String
    Dim rowNo As Long, page As Long, count As Long, serial As Long
    Dim pdfPath As String, stem As String, problem As String
    Dim seenPages As Object, hadBlank As Boolean
    On Error GoTo Failed
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FolderExists(parentFolder) Then _
        Err.Raise vbObjectError + 393, , "保存先フォルダがありません。"
    If Not BatchOverviewHasRecords() Then _
        Err.Raise vbObjectError + 394, , "複数人一覧が空です。先に源泉票を読込してください。"
    Set batch = ThisWorkbook.Worksheets("一括計算一覧")
    Set report = ThisWorkbook.Worksheets("自動試算根拠")
    stem = "Furusato_自動試算根拠_未確定_" & Format$(Now, "yyyymmdd_hhnnss")
    For serial = 1 To 1000
        outputFolder = fso.BuildPath(parentFolder, stem & "_" & CStr(serial))
        staging = fso.BuildPath(parentFolder, "._furusato_stage_" & _
                  Format$(Now, "yyyymmdd_hhnnss") & "_" & CStr(serial))
        If Not fso.FolderExists(outputFolder) And _
           Not fso.FolderExists(staging) Then Exit For
    Next serial
    If serial > 1000 Then Err.Raise vbObjectError + 395, , "出力先の確保に失敗しました。"
    ' Validate entire source first: no partially published report folders.
    count = 0
    hadBlank = False
    Set seenPages = CreateObject("Scripting.Dictionary")
    For rowNo = 6 To 105
        If Len(CStr(batch.Cells(rowNo, 2).Value2)) <> 0 Then
            If hadBlank Then Err.Raise vbObjectError + 396, , _
                "一覧の途中に空行があります。再取込してください。"
            count = count + 1
            If Not IsNumeric(batch.Cells(rowNo, 2).Value2) Then _
                Err.Raise vbObjectError + 396, , "PDFページ番号が不正です。"
            page = CLng(batch.Cells(rowNo, 2).Value2)
            If page < 1 Or page > 100 Or _
               CDbl(page) <> CDbl(batch.Cells(rowNo, 2).Value2) Then _
                Err.Raise vbObjectError + 396, , "PDFページ番号が範囲外です。"
            If seenPages.Exists(CStr(page)) Then _
                Err.Raise vbObjectError + 396, , "同一ページ番号が重複しています。"
            seenPages.Add CStr(page), True
            If Len(CStr(batch.Cells(rowNo, 1).Value2)) = 0 Then _
                Err.Raise vbObjectError + 396, , "氏名欄が空欄です。"
            If CStr(batch.Cells(rowNo, 10).Value2) = "参考額（仮）" And _
               Len(CStr(batch.Cells(rowNo, 12).Value2)) = 0 Then _
                Err.Raise vbObjectError + 397, , _
                  "計算根拠がない旧一覧です。源泉票を再取込してください。"
        Else
            hadBlank = True
        End If
    Next rowNo
    If count < 1 Or count > 100 Then _
        Err.Raise vbObjectError + 398, , "出力人数が上限外です。"
    fso.CreateFolder staging
    report.Visible = xlSheetVisible
    For page = 1 To count
        PopulateBatchReferenceSheet page, batch, report
        pdfPath = fso.BuildPath(staging, _
            "源泉票_ページ" & Format$(CLng(batch.Cells(page + 5, 2).Value2), "000") & "_試算根拠_未確定.pdf")
        report.ExportAsFixedFormat Type:=xlTypePDF, Filename:=pdfPath
        If Not fso.FileExists(pdfPath) Then _
            Err.Raise vbObjectError + 399, , "PDFの生成を確認できません。"
        If fso.GetFile(pdfPath).Size < 500 Then _
            Err.Raise vbObjectError + 400, , "PDFのファイルサイズが不正です。"
    Next page
    ' All per-person values must be purged from the cached PDF template
    ' even though the sheet is veryHidden. Source rows remain in A:R until
    ' the operator presses 一覧消去.
    report.Range("B3:B19").ClearContents
    report.Range("B20:D23").ClearContents
    report.Visible = xlSheetVeryHidden
    fso.MoveFolder staging, outputFolder
    ExportAllBatchReferencePDFsToFolder = count
    Exit Function
Failed:
    problem = Err.Description
    On Error Resume Next
    If Not report Is Nothing Then
        report.Range("B3:B19").ClearContents
        report.Range("B20:D23").ClearContents
        report.Visible = xlSheetVeryHidden
    End If
    If Not fso Is Nothing Then
        If Len(staging) > 0 And fso.FolderExists(staging) Then _
            fso.DeleteFolder staging, True
    End If
    On Error GoTo 0
    Err.Raise vbObjectError + 401, _
        "TaxLawUpdater.ExportAllBatchReferencePDFsToFolder", problem
End Function

Public Sub ExportAllBatchReferencePDFs()
    Dim picker As FileDialog, folder As String, count As Long
    On Error GoTo Failed
    Set picker = Application.FileDialog(msoFileDialogFolderPicker)
    picker.Title = "各人の自動試算根拠PDFをまとめて保存するフォルダを選択"
    If picker.Show <> -1 Then Exit Sub
    folder = CStr(picker.SelectedItems(1))
    count = ExportAllBatchReferencePDFsToFolder(folder)
    MsgBox CStr(count) & "人分の未確定試算根拠PDFを出力しました。" & _
        vbCrLf & "各ファイルは原票のページ番号で区別します。", _
        vbInformation, "自動試算根拠PDF"
    Exit Sub
Failed:
    MsgBox Err.Description, vbExclamation, "自動試算根拠PDF"
End Sub

' Expected failure path probe: never force a VBA modal error on CI runner.
Public Function TryExportAllBatchReferencePDFsForTest( _
        ByVal parentFolder As String) As Boolean
    On Error GoTo Failed
    TryExportAllBatchReferencePDFsForTest = _
        (ExportAllBatchReferencePDFsToFolder(parentFolder) > 0)
    Exit Function
Failed:
    Err.Clear
    TryExportAllBatchReferencePDFsForTest = False
End Function

' Test-only safe failure probe; Excel COM must not display a modal
' VBA run-time-error dialogue when a malformed batch file is rejected.
' Production still calls the strict loader and its user-facing error handler.
' Isolated CI can retrieve only the numeric inner error (never its text).
Public Function BatchLastInnerErrorForTest() As Long
    BatchLastInnerErrorForTest = mBatchLastInnerError
End Function

Public Function TryLoadBatchFromTsvForTest(ByVal tsvPath As String) As Boolean
    On Error GoTo Rejected
    TryLoadBatchFromTsvForTest = (LoadBatchFromTsv(tsvPath) > 0)
    Exit Function
Rejected:
    Err.Clear
    TryLoadBatchFromTsvForTest = False
End Function

Private Function BatchReasonLabel(ByVal code As String) As String
    Select Case code
        Case "AUTO_SOURCE_ASSUMPTION"
            BatchReasonLabel = "確定申告なし・ワンストップ特例適用、給与のみ等を仮定した参考額"
        Case "AUTO_ONE_STOP_HOUSING"
            BatchReasonLabel = "住宅ローン控除を考慮した仮の参考額（ワンストップ・給与のみ仮定）"
        Case "AUTO_ONE_STOP_HOUSING_SPOUSE_INFERRED"
            BatchReasonLabel = "住宅控除を含む仮の参考額／配偶者控除額は原票の所得控除合計との差額から仮定（要確認）"
        Case "AUTO_SOURCE_HOLD"
            BatchReasonLabel = "原票の必須項目欠落・不一致等で自動目安は保留"
        Case "MORTGAGE_POSSIBLE_AMOUNT_MISSING"
            BatchReasonLabel = "住宅ローン控除可能額が不明。源泉票の記載を確認"
        Case "MORTGAGE_DEDUCTION_DETAIL_REVIEW"
            BatchReasonLabel = "所得控除合計と社会保険・配偶者・生命・地震等の内訳が不一致"
        Case "MORTGAGE_BASIC_DEDUCTION_REVIEW"
            BatchReasonLabel = "原票年分の基礎控除額と再計算額が不一致"
        Case "MORTGAGE_LIFE_PREMIUM_REVIEW"
            BatchReasonLabel = "生命保険料内訳と源泉票控除額の照合が不一致"
        Case "MORTGAGE_EARTHQUAKE_REVIEW"
            BatchReasonLabel = "地震保険料と旧長期損害保険料の区分を確認"
        Case "MORTGAGE_SPOUSE_DEDUCTION_REVIEW"
            BatchReasonLabel = "配偶者所得・控除額の原票照合が未完了"
        Case "MORTGAGE_FAMILY_DEDUCTION_REVIEW"
            BatchReasonLabel = "扶養親族・特定親族等の要件を個別に確認"
        Case "MORTGAGE_OCCUPANCY_CLASS_REVIEW"
            BatchReasonLabel = "住宅ローン控除の居住開始年・取得区分を確認"
        Case "MORTGAGE_NEXT_YEAR_REVIEW"
            BatchReasonLabel = "前年票では翌年の住宅ローン控除額を確定できません"
        Case "MORTGAGE_LOCAL_TAX_REVIEW"
            BatchReasonLabel = "自治体の特別税率等を確認（個別計算が必要）"
        Case "MORTGAGE_ONE_STOP_REQUIRES_INDIVIDUAL_REVIEW"
            BatchReasonLabel = "住宅ローン控除額・源泉税額の照合や控除内訳の確認が必要"
        Case "SALARY_ONLY_HYPOTHESIS"
            BatchReasonLabel = "給与所得のみ・他所得等なしを仮定"
        Case "INCOME_LEVY_EXEMPT_SALARY_ONLY"
            BatchReasonLabel = "給与所得のみなら住民税所得割非課税（参考0円）"
        Case "LIFE_PREMIUM_SINGLE_ONLY", "LIFE_DEDUCTION_NOT_RECONCILED"
            BatchReasonLabel = "生命保険料の控除内訳を単独計算で確認"
        Case "UNDER16_REVIEW_REQUIRED"
            BatchReasonLabel = "16歳未満の扶養人数を確認"
        Case "YEAR_UNREADABLE"
            BatchReasonLabel = "源泉徴収票の所得年を確認"
        Case "REQUIRED_FIELDS_MISSING"
            BatchReasonLabel = "給与・控除など必須数値を原票確認"
        Case "SOURCE_WARNINGS_MISSING", "SOURCE_REVIEW_REQUIRED"
            BatchReasonLabel = "源泉票の読取結果を個別確認"
        Case "COMPLEX_DEDUCTIONS_SINGLE_ONLY"
            BatchReasonLabel = "扶養・保険料・住宅控除等は単独精緻計算"
        Case "HIGH_INCOME_SINGLE_ONLY"
            BatchReasonLabel = "高額給与の特例は単独計算"
        Case "SALARY_REFERENCE_NOT_RECONCILED"
            BatchReasonLabel = "給与所得の法定計算との不一致"
        Case "NATIONAL_DEDUCTIONS_SINGLE_ONLY"
            BatchReasonLabel = "所得控除の内訳は単独計算で確認"
        Case "SOURCE_TAX_NOT_RECONCILED"
            BatchReasonLabel = "源泉税額との整合性が未確認"
        Case "FAMILY_EXEMPTION_MAY_APPLY"
            BatchReasonLabel = "扶養人数による住民税非課税を個別確認"
        Case "RESIDENT_TAX_SINGLE_ONLY"
            BatchReasonLabel = "住民税の課税条件を個別確認"
        Case "MUNICIPALITY_UNCERTAIN"
            BatchReasonLabel = "自治体区分により試算額が異なります"
        Case "UNSUPPORTED_OR_UNVERIFIED"
            BatchReasonLabel = "一括計算の対応条件外"
        Case "PAGE_READ_ERROR"
            BatchReasonLabel = "該当ページを読み取れません"
        Case "EDIT_INPUT_REVIEW_REQUIRED", "EDIT_REQUIRED_FIELDS_MISSING"
            BatchReasonLabel = "手修正後の給与・控除等の必須項目が不足しています。入力内容を確認"
        Case "EDIT_SALARY_OUTSIDE_SUPPORTED_SCOPE", "EDIT_BASIC_DEDUCTION_OUTSIDE_SCOPE"
            BatchReasonLabel = "給与収入・所得または基礎控除が一括計算の対応範囲外"
        Case "EDIT_INCOME_ADJUSTMENT_INVALID"
            BatchReasonLabel = "所得金額調整控除額の入力範囲を確認"
        Case "EDIT_SALARY_INCOME_MISMATCH"
            BatchReasonLabel = "修正した給与支払額と給与所得額が対象年の給与所得計算と不一致"
        Case "EDIT_LIFE_PREMIUM_INVALID"
            BatchReasonLabel = "生命保険料内訳が不正。新旧・介護医療・個人年金の支払額を確認"
        Case "EDIT_EARTHQUAKE_PREMIUM_REVIEW"
            BatchReasonLabel = "地震保険料控除額と旧長期損害保険の区分を確認"
        Case "EDIT_SPOUSE_DEDUCTION_REVIEW"
            BatchReasonLabel = "配偶者控除額・配偶者所得等の組合せを確認"
        Case "EDIT_SPECIAL_RELATIVE_REVIEW"
            BatchReasonLabel = "特定親族の年齢・所得と控除額は個別確認が必要"
        Case "EDIT_FAMILY_DEDUCTION_REVIEW"
            BatchReasonLabel = "扶養親族の区分・人数、23歳未満の生命保険特例の確認が必要"
        Case "EDIT_DEDUCTIONS_NOT_RECONCILED"
            BatchReasonLabel = "修正後の所得控除内訳が対象年の控除計算と一致しません"
        Case "EDIT_SOURCE_TAX_MISMATCH"
            BatchReasonLabel = "修正後の給与・控除・住宅ローン控除と源泉徴収税額が不一致"
        Case "EDIT_SOURCE_TAX_OR_DEDUCTIONS_REVIEW"
            BatchReasonLabel = "修正後の源泉徴収税額・控除額・税制条件を再確認"
        Case Else
            Err.Raise vbObjectError + 360, , "一覧の理由コードが未承認です。"
    End Select
End Function

Private Function ParseBatchNumber(ByVal source As String, _
                                  ByVal allowEmpty As Boolean) As Variant
    If source = "" And allowEmpty Then
        ParseBatchNumber = Empty
        Exit Function
    End If
    If Len(source) = 0 Or Len(source) > 13 Or source Like "*[!0-9]*" Then
        Err.Raise vbObjectError + 344, , "一括一覧の金額が不正です。"
    End If
    If CDbl(source) > 1000000000000# Then
        Err.Raise vbObjectError + 345, , "一括一覧の金額が上限を超えています。"
    End If
    ParseBatchNumber = CDbl(source)
End Function

' Public only for isolated PC Excel tests with fabricated TSV; production
' invokes it after the offline reader exits successfully.  All input lines
' are validated BEFORE the first worksheet mutation, and a worksheet-level
' rollback preserves the previous list if a subsequent Excel write fails.
' Only printable name characters accepted by the E03 decoder can be sent
' back to the EXE. Never transfer formulas, PDF text, or source paths.
Private Function EncodeRecipientForBatch(ByVal candidate As String) As String
    Dim idx As Long, cp As Long, encoded As String
    If Len(candidate) < 1 Or Len(candidate) > 40 Then _
        Err.Raise vbObjectError + 460, , "氏名の文字数を確認してください。"
    For idx = 1 To Len(candidate)
        cp = AscW(Mid$(candidate, idx, 1))
        If cp < 0 Then cp = cp + 65536
        encoded = encoded & Right$("0000" & Hex$(cp), 4)
    Next idx
    If DecodeRecipientNameForBatch(encoded) <> candidate Then _
        Err.Raise vbObjectError + 461, , "氏名を確認してください。"
    EncodeRecipientForBatch = encoded
End Function

Private Function BatchEditedValue(ByVal cell As Range, _
                                  ByVal index As Long) As String
    Dim value As Variant, s As String, n As Double
    If cell.HasFormula Then _
        Err.Raise vbObjectError + 462, , "修正欄にExcelの数式を使用できません。"
    value = cell.Value2
    If IsEmpty(value) Then Exit Function
    If Len(CStr(value)) = 0 Then Exit Function
    If index = 3 Then
        s = CStr(value)
        Select Case s
            Case "STANDARD", "DESIGNATED", "SPECIAL", "UNCERTAIN", ""
            Case Else
                Err.Raise vbObjectError + 463, , "自治体区分が不正です。"
        End Select
    ElseIf index = 4 Then
        s = CStr(value)
        Select Case s
            Case "PDF_TEXT", "PDF_PAGE_SELECTED", _
                 "STRUCTURED_JSON", "STRUCTURED_TEXT", "TEXT_LABELS", ""
            Case Else
                Err.Raise vbObjectError + 463, , "資料種別が不正です。"
        End Select
    ElseIf index = 5 Then
        s = CStr(value)
        If Len(s) > 250 Or s Like "*[!A-Z0-9_|]*" Then _
            Err.Raise vbObjectError + 463, , "源泉票の注意コードを確認してください。"
    Else
        If Not IsNumeric(value) Then _
            Err.Raise vbObjectError + 464, , "入力数値を確認してください。"
        n = CDbl(value)
        If n < 0 Or n > 1000000000000# Or n <> Fix(n) Then _
            Err.Raise vbObjectError + 465, , "数値は0以上の整数にしてください。"
        s = Format$(n, "0")
    End If
    BatchEditedValue = s
End Function


' Shared serialiser: production and isolated PC1 QA use exactly the same
' validation, field order, page isolation, and ASCII-only name encoding.
' This function does NOT execute a program or accept user-provided formulas.
Private Function WriteBatchEditorInputFile(ByVal outputPath As String) As Long
    Dim editor As Worksheet, summary As Worksheet, fso As Object, file As Object
    Dim index As Long, col As Long, total As Long, line As String
    Dim failureNumber As Long, failureText As String
    On Error GoTo Failed
    Set editor = ThisWorkbook.Worksheets("一括入力修正")
    Set summary = ThisWorkbook.Worksheets("一括計算一覧")
    If Not BatchOverviewHasRecords() Then _
        Err.Raise vbObjectError + 466, , "先に源泉票の一括取込をしてください。"
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then _
        Err.Raise vbObjectError + 467, , _
            "書き込み可能なローカルのExcelブックが必要です。"
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.FileExists(outputPath) Then _
        Err.Raise vbObjectError + 475, , "修正データファイルが既にあります。"
    ' Fail closed on pre-existing or invalid rows before creating any input.
    total = 0
    For index = 1 To 100
        If Len(CStr(summary.Cells(index + 5, 2).Value2)) = 0 Then Exit For
        total = total + 1
        If Not IsNumeric(summary.Cells(index + 5, 2).Value2) Or _
           Not IsNumeric(editor.Cells(index + 5, 2).Value2) Then _
            Err.Raise vbObjectError + 469, , "原票ページが数値ではありません。"
        If CDbl(summary.Cells(index + 5, 2).Value2) <> CDbl(index) Or _
           CDbl(editor.Cells(index + 5, 2).Value2) <> CDbl(index) Then _
            Err.Raise vbObjectError + 469, , "原票ページと編集行が不一致です。"
        If editor.Cells(index + 5, 1).HasFormula Then _
            Err.Raise vbObjectError + 470, , "氏名に数式を入力できません。"
    Next index
    If total < 1 Then Err.Raise vbObjectError + 471, , "修正データがありません。"
    For index = total + 1 To 100
        If Len(CStr(editor.Cells(index + 5, 2).Value2)) > 0 Or _
           Len(CStr(summary.Cells(index + 5, 2).Value2)) > 0 Then _
            Err.Raise vbObjectError + 472, , "編集行の人数が不正です。"
    Next index
    Set file = fso.CreateTextFile(outputPath, False, False)
    file.WriteLine "PAGE" & vbTab & "RECIPIENT_NAME_HEX" & vbTab & _
                   BatchEditFieldHeaderTrial()
    For index = 1 To total
        line = CStr(index) & vbTab & _
               EncodeRecipientForBatch(CStr(editor.Cells(index + 5, 1).Value2))
        For col = 1 To 33
            line = line & vbTab & _
                   BatchEditedValue(editor.Cells(index + 5, col + 2), col)
        Next col
        file.WriteLine line
    Next index
    file.Close
    Set file = Nothing
    WriteBatchEditorInputFile = total
    Exit Function
Failed:
    failureNumber = Err.Number
    failureText = Err.Description
    On Error Resume Next
    If Not file Is Nothing Then file.Close
    If Not fso Is Nothing Then
        If fso.FileExists(outputPath) Then fso.DeleteFile outputPath, True
    End If
    On Error GoTo 0
    Err.Raise failureNumber, "TaxLawUpdater.WriteBatchEditorInputFile", failureText
End Function

' Export exactly the same serialisation for the disposable QA workbook.
' It is disabled in regular customer workbooks and cannot execute the reader.
Public Function ExportBatchEditsForTest() As Long
    Dim outputPath As String
    On Error GoTo Failed
    If StrComp(ThisWorkbook.Name, "FurusatoQA.xlsm", vbBinaryCompare) <> 0 _
        Then Exit Function
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then Exit Function
    outputPath = ThisWorkbook.Path & Application.PathSeparator & _
                 "synthetic-editor-input.tsv"
    ExportBatchEditsForTest = WriteBatchEditorInputFile(outputPath)
    Exit Function
Failed:
    ExportBatchEditsForTest = 0
End Function

' Windows can transiently deny launch during inspection of the exact
' local reader. Retry at most once, same command and security context.
' Permanent access denial remains an error; never change Office/AV policy.
Private Function RunBatchReaderWithAccessRetry(ByVal launcher As Object, _
        ByVal command As String, ByVal fso As Object, _
        ByVal outputPath As String) As Long
    Dim firstError As Long
    mBatchRecalcLastLaunchAttempts = 1
    On Error Resume Next
    RunBatchReaderWithAccessRetry = launcher.Run(command, 0, True)
    firstError = Err.Number
    Err.Clear
    On Error GoTo 0
    If firstError = 0 Then Exit Function
    If firstError <> 70 Or fso.FileExists(outputPath) Then
        Err.Raise firstError, "TaxLawUpdater.ReaderLaunch", _
                  "読取EXEの起動が拒否されました。元の一覧は変更していません。"
    End If
    Application.Wait Now + TimeSerial(0, 0, 1)
    mBatchRecalcLastLaunchAttempts = 2
    RunBatchReaderWithAccessRetry = launcher.Run(command, 0, True)
End Function

' Does not read/modify the single-taxpayer screen.  Only anonymous page
' identities and whitelisted values are sent to the offline bundled reader.
' Rebuilding from all rows is transactional: a failed CLI or TSV leaves
' both the preview and the user's corrections untouched.
Public Function RecalculateBatchFromEditor( _
        Optional ByVal quiet As Boolean = False) As Long
    Dim editor As Worksheet, summary As Worksheet, fso As Object, shell As Object
    Dim reader As String, temporaryIn As String, temporaryOut As String
    Dim file As Object, line As String, command As String
    Dim index As Long, col As Long, total As Long, exitCode As Long
    Dim problem As String
    On Error GoTo Failed
    mBatchRecalcLastStage = 1
    mBatchRecalcLastError = 0
    mBatchRecalcLastExitCode = -1
    mBatchRecalcLastLaunchAttempts = 0
    Set editor = ThisWorkbook.Worksheets("一括入力修正")
    Set summary = ThisWorkbook.Worksheets("一括計算一覧")
    If Not BatchOverviewHasRecords() Then _
        Err.Raise vbObjectError + 466, , "先に源泉票の一括取込をしてください。"
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then _
        Err.Raise vbObjectError + 467, , _
            "書き込み可能なローカルのExcelブックが必要です。"
    Set fso = CreateObject("Scripting.FileSystemObject")
    reader = fso.BuildPath(ThisWorkbook.Path, "FurusatoDocumentReader.exe")
    If Not fso.FileExists(reader) Then _
        Err.Raise vbObjectError + 468, , "同梱の読取EXEが見つかりません。"
    mBatchRecalcLastStage = 2
    temporaryIn = fso.BuildPath(fso.GetSpecialFolder(2), _
                                fso.GetTempName & ".tsv")
    temporaryOut = fso.BuildPath(fso.GetSpecialFolder(2), _
                                 fso.GetTempName & ".tsv")
    total = WriteBatchEditorInputFile(temporaryIn)
    mBatchRecalcLastStage = 3
    Set shell = CreateObject("WScript.Shell")
    command = Chr$(34) & reader & Chr$(34) & _
              " --input " & Chr$(34) & temporaryIn & Chr$(34) & _
              " --output " & Chr$(34) & temporaryOut & Chr$(34) & _
              " --batch-recalculate"
    mBatchRecalcLastStage = 4
    exitCode = RunBatchReaderWithAccessRetry(shell, command, fso, temporaryOut)
    mBatchRecalcLastExitCode = exitCode
    mBatchRecalcLastStage = 5
    If exitCode <> 0 Or Not fso.FileExists(temporaryOut) Then _
        Err.Raise vbObjectError + 473, , _
            "修正値の検証・再計算に失敗しました。元の一覧は変更していません。"
    mBatchRecalcLastStage = 6
    RecalculateBatchFromEditor = LoadBatchFromTsv(temporaryOut)
    If RecalculateBatchFromEditor <> total Then _
        Err.Raise vbObjectError + 474, , "再計算した人数が一致しません。"
    mBatchRecalcLastStage = 7
CleanUp:
    On Error Resume Next
    If Not file Is Nothing Then file.Close
    If Not fso Is Nothing Then
        If Len(temporaryIn) > 0 Then
            If fso.FileExists(temporaryIn) Then fso.DeleteFile temporaryIn, True
        End If
        If Len(temporaryOut) > 0 Then
            If fso.FileExists(temporaryOut) Then fso.DeleteFile temporaryOut, True
        End If
    End If
    Exit Function
Failed:
    mBatchRecalcLastError = Err.Number
    problem = Err.Description
    On Error Resume Next
    If Not file Is Nothing Then file.Close
    On Error GoTo 0
    If Not quiet Then _
        MsgBox problem, vbExclamation, "一括入力の再計算"
    GoTo CleanUp
End Function

' Numeric-only, never copied to the PDF or taxpayer overview.
Public Function BatchRecalcLastStageForTest() As Long
    BatchRecalcLastStageForTest = mBatchRecalcLastStage
End Function

Public Function BatchRecalcLastErrorForTest() As Long
    BatchRecalcLastErrorForTest = mBatchRecalcLastError
End Function

Public Function BatchRecalcLastExitCodeForTest() As Long
    BatchRecalcLastExitCodeForTest = mBatchRecalcLastExitCode
End Function

' How many identical launch attempts were made (0/1/2); no paths or names.
Public Function BatchRecalcLaunchAttemptsForTest() As Long
    BatchRecalcLaunchAttemptsForTest = mBatchRecalcLastLaunchAttempts
End Function

' Nonmodal entry used by the isolated Windows Excel test.
Public Function TryRecalculateBatchForTest() As Boolean
    On Error GoTo Failed
    TryRecalculateBatchForTest = (RecalculateBatchFromEditor(True) > 0)
    Exit Function
Failed:
    Err.Clear
    TryRecalculateBatchForTest = False
End Function

' A single schema definition is used to load source detail fields and to
' export corrected values back to the Python-free offline reader.
Private Function BatchEditFieldHeaderLegacy() As String
    BatchEditFieldHeaderLegacy = Join(Array( _
        "EDIT_SOURCE_YEAR", "EDIT_TARGET_YEAR", "EDIT_MUNI_CLASS", _
        "EDIT_FORMAT", "EDIT_WARNINGS", "EDIT_SALARY_GROSS", _
        "EDIT_SALARY_REFERENCE", "EDIT_INCOME_TAX_WITHHELD", _
        "EDIT_SOCIAL_INSURANCE", "EDIT_LIFE_NEW", "EDIT_LIFE_OLD", _
        "EDIT_MEDICAL_CARE", "EDIT_ANNUITY_NEW", "EDIT_ANNUITY_OLD", _
        "EDIT_EARTHQUAKE_DEDUCTION_REFERENCE", _
        "EDIT_OLD_LONG_PREMIUM_REFERENCE", "EDIT_SPOUSE_DEDUCTION_REFERENCE", _
        "EDIT_SPOUSE_INCOME_REFERENCE", "EDIT_SPOUSE_ELIGIBILITY_FLAG", _
        "EDIT_UNDER16_COUNT", "EDIT_SPECIAL_RELATIVE_COUNT", _
        "EDIT_SPECIAL_RELATIVE_DEDUCTION_REFERENCE", "EDIT_INCOME_ADJUSTMENT", _
        "EDIT_MORTGAGE_CREDIT", "EDIT_MORTGAGE_POSSIBLE_CREDIT", _
        "EDIT_MORTGAGE_OCCUPANCY_YEAR", "EDIT_MORTGAGE_CLAIM_COUNT"), vbTab)
End Function

Private Function BatchEditFieldHeader() As String
    BatchEditFieldHeader = BatchEditFieldHeaderLegacy() & vbTab & Join(Array( _
        "EDIT_DEPENDENT_GENERAL_COUNT", "EDIT_DEPENDENT_SPECIAL_COUNT", _
        "EDIT_DEPENDENT_ELDERLY_COUNT", _
        "EDIT_DEPENDENT_COHABITING_ELDERLY_COUNT", _
        "EDIT_UNDER23_LIFE_ELIGIBLE_FLAG"), vbTab)
End Function

Private Function BatchEditFieldHeaderTrial() As String
    BatchEditFieldHeaderTrial = BatchEditFieldHeader() & vbTab & _
                               "EDIT_TRIAL_DONATION"
End Function

Public Function LoadBatchFromTsv(ByVal tsvPath As String) As Long
    Dim fso As Object, inputFile As Object, target As Worksheet
    Dim rows As Collection, pieces As Variant, record As Variant
    Dim line As String, requiredHeader As String, status As String
    Dim page As Long, col As Long, index As Long, oldData As Variant
    Dim oldHeights(6 To 105) As Double
    Dim changed As Boolean, problem As String
    Dim header As String, reportHeader As String, withReport As Boolean
    Dim nameHeader As String, withName As Boolean
    Dim filingHeader As String, withFiling As Boolean
    Dim trialEditHeader As String, withTrial As Boolean
    Dim editHeader As String, legacyEditHeader As String, withEdit As Boolean
    Dim editFieldCount As Long
    Dim editor As Worksheet, oldEdit As Variant
    Dim filingLimit As Variant
    mBatchLastInnerError = 0
    On Error GoTo Failed
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FileExists(tsvPath) Then
        Err.Raise vbObjectError + 346, , "一覧データがありません。"
    End If
    If fso.GetFile(tsvPath).Size > 128000 Then
        Err.Raise vbObjectError + 347, , "一覧データが上限を超えています。"
    End If
    requiredHeader = Join(Array("PAGE", "YEAR", "SALARY_GROSS", _
        "SALARY_INCOME", "TOTAL_DEDUCTIONS", "SOURCE_TAX", _
        "SOCIAL_INSURANCE", "REFERENCE_LIMIT", "STATUS", "REASON"), vbTab)
    reportHeader = requiredHeader & vbTab & Join(Array( _
        "R_SOURCE_YEAR", "R_SOURCE_BASIC", "R_RESIDENT_DEDUCTIONS", _
        "R_RESIDENT_TAXABLE", "R_RESIDENT_LEVY", "R_SPECIAL_RATIO_PPM", _
        "R_SPECIAL_CAP", "R_MODEL_LOCALITY"), vbTab)
    nameHeader = reportHeader & vbTab & "RECIPIENT_NAME_HEX"
    filingHeader = nameHeader & vbTab & "FILING_LIMIT"
    legacyEditHeader = filingHeader & vbTab & BatchEditFieldHeaderLegacy()
    editHeader = filingHeader & vbTab & BatchEditFieldHeader()
    trialEditHeader = filingHeader & vbTab & BatchEditFieldHeaderTrial() & _
                      vbTab & "FILING_TRIAL_DONATION" & _
                      vbTab & "FILING_TRIAL_BURDEN"
    Set inputFile = fso.OpenTextFile(tsvPath, 1, False, 0)
    If inputFile.AtEndOfStream Then Err.Raise vbObjectError + 348, , "一覧データが空です。"
    header = inputFile.ReadLine
    If header <> requiredHeader And header <> reportHeader And _
       header <> nameHeader And header <> filingHeader And _
       header <> legacyEditHeader And header <> editHeader And _
       header <> trialEditHeader Then
        Err.Raise vbObjectError + 349, , "一覧データの形式が承認済みのものではありません。"
    End If
    withTrial = (header = trialEditHeader)
    withEdit = (header = editHeader Or header = legacyEditHeader Or withTrial)
    editFieldCount = IIf(withTrial, 33, IIf(header = legacyEditHeader, 27, 32))
    withFiling = (header = filingHeader Or withEdit)
    withName = (header = nameHeader Or withFiling)
    withReport = (header = reportHeader Or withName)
    Set rows = New Collection
    Do Until inputFile.AtEndOfStream
        line = inputFile.ReadLine
        pieces = Split(line, vbTab)
        If UBound(pieces) <> IIf(withTrial, 21 + editFieldCount, _
                                    IIf(withEdit, 19 + editFieldCount, IIf(withFiling, 19, _
                                    IIf(withName, 18, IIf(withReport, 17, 9))))) Then
            Err.Raise vbObjectError + 350, , "一括一覧の列数が不正です。"
        End If
        If rows.Count >= 100 Then
            Err.Raise vbObjectError + 351, , "一括一覧は100ページ以内です。"
        End If
        page = CLng(ParseBatchNumber(CStr(pieces(0)), False))
        If page <> rows.Count + 1 Then
            Err.Raise vbObjectError + 352, , "ページ番号が不連続です。"
        End If
        If pieces(1) <> "" And pieces(1) <> "2025" And pieces(1) <> "2026" Then
            Err.Raise vbObjectError + 353, , "一覧の所得年が不正です。"
        End If
        status = CStr(pieces(8))
        If status <> "HOLD" And status <> "PROVISIONAL" Then
            Err.Raise vbObjectError + 354, , "一覧の検証状態が不正です。"
        End If
        If status = "HOLD" And Len(CStr(pieces(7))) > 0 Then
            Err.Raise vbObjectError + 355, , "保留行に限度額が含まれています。"
        End If
        If status = "PROVISIONAL" And _
           (Len(CStr(pieces(7))) = 0 Or pieces(1) = "") Then
            Err.Raise vbObjectError + 356, , "参考額の根拠がありません。"
        End If
        If Len(CStr(pieces(9))) = 0 Or _
            Len(CStr(pieces(9))) > 64 Or _
            CStr(pieces(9)) Like "*[!A-Z_]*" Then
            Err.Raise vbObjectError + 357, , "一覧の理由コードが不正です。"
        End If
        ReDim record(1 To 55)
        record(1) = "氏名未判読"
        If withName Then record(1) = DecodeRecipientNameForBatch(CStr(pieces(18)))
        For col = 1 To 8
            record(col + 1) = ParseBatchNumber(CStr(pieces(col - 1)), _
                                          col > 1 And status = "HOLD")
        Next col
        record(10) = IIf(status = "HOLD", "HOLD／要確認", "参考額（仮）")
        record(11) = BatchReasonLabel(CStr(pieces(9)))
        If withReport Then
            If status = "HOLD" Then
                For col = 10 To 17
                    If Len(CStr(pieces(col))) > 0 Then _
                        Err.Raise vbObjectError + 362, , "HOLD行に計算根拠数値があります。"
                Next col
            Else
                For col = 12 To 18
                    record(col) = ParseBatchNumber(CStr(pieces(col - 2)), False)
                Next col
                If record(12) <> 2025 And record(12) <> 2026 Then _
                    Err.Raise vbObjectError + 363, , "根拠の源泉票年が不正です。"
                If record(17) > 900000 Or record(18) <> record(16) / 5 Then _
                    Err.Raise vbObjectError + 364, , "根拠の特例控除率が不正です。"
                Select Case CStr(pieces(17))
                    Case "STANDARD", "DESIGNATED", "UNCERTAIN"
                        record(19) = CStr(pieces(17))
                    Case Else
                        Err.Raise vbObjectError + 365, , "根拠の自治体区分が不正です。"
                End Select
            End If
        End If
        ' Never present a previous-year mortgage as a verified current balance.
        ' The amount is a *projection* with the printed G36 unchanged; all
        ' unverified family, income and locality conditions remain assumptions.
        If withReport And status = "PROVISIONAL" Then
            If CDbl(record(12)) <> CDbl(record(3)) Then
                record(11) = CStr(record(11)) & _
                    "／原票" & CStr(record(12)) & "年→試算" & _
                    CStr(record(3)) & "年（試算年の税制・前年条件継続を仮定）"
                If CStr(pieces(9)) = "AUTO_ONE_STOP_HOUSING" Then
                    record(11) = CStr(record(11)) & _
                        "／住宅ローン残高の変動は考慮せず、原票の控除可能額を据置き"
                End If
            End If
        End If
        ' Both modes have their own visible columns: I = one-stop, T =
        ' filing. Never substitute one limit for an unverified other mode.
        ' VBA And is NOT short circuit: never index pieces(19) for v1/v2/v3
        ' rows that contain only 10/18/19 fields. A Subscript-out-of-range
        ' exception otherwise opens an unattended Excel error dialog.
        If withFiling Then
            If Len(CStr(pieces(19))) > 0 Then
                If status <> "PROVISIONAL" Then _
                    Err.Raise vbObjectError + 405, , _
                        "保留行に確定申告の参考額は設定できません。"
                filingLimit = ParseBatchNumber(CStr(pieces(19)), False)
                If CDbl(filingLimit) < 0 Or _
                   CDbl(filingLimit) > 1000000000# Or _
                   CDbl(filingLimit) <> Fix(CDbl(filingLimit) / 1000#) * 1000# Then _
                    Err.Raise vbObjectError + 406, , _
                        "確定申告時の限度額が不正です。"
                record(20) = filingLimit
                If CDbl(filingLimit) > CDbl(record(9)) Then
                    record(11) = CStr(record(11)) & _
                        "／確定申告の方が上限額増"
                End If
            ElseIf status = "PROVISIONAL" Then
                record(11) = CStr(record(11)) & _
                    "／確定申告時上限は条件不足につき要確認"
            End If
        End If
        If withEdit Then
            For col = 1 To editFieldCount
                Select Case col
                    Case 3
                        Select Case CStr(pieces(19 + col))
                            Case "", "STANDARD", "DESIGNATED", "SPECIAL", "UNCERTAIN"
                                record(20 + col) = CStr(pieces(19 + col))
                            Case Else
                                Err.Raise vbObjectError + 407, , "自治体区分が不正です。"
                        End Select
                    Case 4
                        Select Case CStr(pieces(19 + col))
                            Case "", "PDF_TEXT", "PDF_PAGE_SELECTED", _
                                 "STRUCTURED_JSON", "STRUCTURED_TEXT", "TEXT_LABELS"
                                record(20 + col) = CStr(pieces(19 + col))
                            Case Else
                                Err.Raise vbObjectError + 407, , "資料種別が不正です。"
                        End Select
                    Case 5
                        If Len(CStr(pieces(19 + col))) > 250 Or _
                           CStr(pieces(19 + col)) Like "*[!A-Z0-9_|]*" Then _
                            Err.Raise vbObjectError + 407, , "注意コードが不正です。"
                        record(20 + col) = CStr(pieces(19 + col))
                    Case Else
                        record(20 + col) = ParseBatchNumber( _
                            CStr(pieces(19 + col)), True)
                        If Len(CStr(pieces(19 + col))) > 0 Then
                            If CDbl(record(20 + col)) > 1000000000000# Then _
                                Err.Raise vbObjectError + 407, , "修正用数値が大きすぎます。"
                        End If
                End Select
            Next col
        End If
        If withTrial Then
            If Len(CStr(pieces(20 + editFieldCount))) > 0 Or _
               Len(CStr(pieces(21 + editFieldCount))) > 0 Then
                If status <> "PROVISIONAL" Or _
                   Len(CStr(pieces(20 + editFieldCount))) = 0 Or _
                   Len(CStr(pieces(21 + editFieldCount))) = 0 Then _
                    Err.Raise vbObjectError + 480, , "保留行・片側のみの試算値は使用できません。"
                record(54) = ParseBatchNumber(CStr(pieces(20 + editFieldCount)), False)
                record(55) = ParseBatchNumber(CStr(pieces(21 + editFieldCount)), False)
                If record(54) < 2000 Or record(54) > 1000000000# Or _
                   record(54) <> Fix(record(54) / 1000#) * 1000# Or _
                   record(55) < 0 Or record(55) > record(54) Then _
                    Err.Raise vbObjectError + 481, , "確定申告の寄附額・自己負担額が不正です。"
            End If
        End If
        rows.Add record
    Loop
    inputFile.Close
    Set inputFile = Nothing
    If rows.Count < 1 Then Err.Raise vbObjectError + 358, , "ページがありません。"
    Set target = ThisWorkbook.Worksheets("一括計算一覧")
    Set editor = ThisWorkbook.Worksheets("一括入力修正")
    target.Unprotect
    oldEdit = editor.Range("A6:AI105").Value2
    oldData = target.Range("A6:V105").Value2
    For page = 6 To 105
        oldHeights(page) = target.Rows(page).RowHeight
    Next page
    changed = True
    target.Range("A6:V105").ClearContents
    editor.Range("A6:AI105").ClearContents
    target.Rows("6:105").RowHeight = 21
    For index = 1 To rows.Count
        record = rows.Item(index)
        For col = 1 To 20
            target.Cells(index + 5, col).Value2 = record(col)
        Next col
        If withTrial Then
            target.Cells(index + 5, 21).Value2 = record(54)
            target.Cells(index + 5, 22).Value2 = record(55)
        End If
        If withEdit Then
            editor.Cells(index + 5, 1).Value2 = record(1)
            editor.Cells(index + 5, 2).Value2 = record(2)
            For col = 1 To editFieldCount
                editor.Cells(index + 5, col + 2).Value2 = record(20 + col)
            Next col
        End If
    Next index
    ' K is the wrapped remarks column. Auto-fit only the populated rows,
    ' preserving the previous row heights when the transaction rolls back.
    target.Range("A6:K" & CStr(rows.Count + 5)).Rows.AutoFit
    For index = 1 To rows.Count
        If target.Rows(index + 5).RowHeight < 21 Then _
            target.Rows(index + 5).RowHeight = 21
        ' Japanese wrapped notes can need several rows even for fewer than
        ' 50 characters (roughly two Excel-width units per Kanji). The
        ' previous 50-character threshold let the independent filing
        ' comparison be clipped on an actual 125% DPI Windows Excel run.
        ' AutoFit is unreliable across installed printers, so apply minimum
        ' physical row heights for all populated comparison notes.
        If Len(CStr(target.Cells(index + 5, 11).Value2)) >= 30 Then
            If target.Rows(index + 5).RowHeight < 66 Then _
                target.Rows(index + 5).RowHeight = 66
        End If
        If Len(CStr(target.Cells(index + 5, 11).Value2)) >= 75 Then
            If target.Rows(index + 5).RowHeight < 90 Then _
                target.Rows(index + 5).RowHeight = 90
        End If
    Next index
    target.Protect AllowFiltering:=True, UserInterfaceOnly:=True
    target.Activate
    LoadBatchFromTsv = rows.Count
    Exit Function
Failed:
    problem = Err.Description
    mBatchLastInnerError = Err.Number
    On Error Resume Next
    If Not inputFile Is Nothing Then inputFile.Close
    If changed Then
        target.Unprotect
        target.Range("A6:V105").Value2 = oldData
        editor.Range("A6:AI105").Value2 = oldEdit
        For page = 6 To 105
            target.Rows(page).RowHeight = oldHeights(page)
        Next page
    End If
    If Not target Is Nothing Then _
        target.Protect AllowFiltering:=True, UserInterfaceOnly:=True
    On Error GoTo 0
    Err.Raise vbObjectError + 359, "TaxLawUpdater.LoadBatchFromTsv", problem
End Function



' One PDF may contain many unrelated people. Show a separate per-page table;
' never aggregate them or transfer any name/house number to Excel.
Private Sub AutoImportAllPages(ByVal sourcePdf As String, ByVal reader As String)
    Dim fso As Object, shell As Object, tempTsv As String, cmd As String
    Dim code As Long, count As Long, reason As String
    On Error GoTo Failed
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set shell = CreateObject("WScript.Shell")
    tempTsv = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName & ".tsv")
    cmd = Chr$(34) & reader & Chr$(34) & _
        " --input " & Chr$(34) & sourcePdf & Chr$(34) & _
        " --output " & Chr$(34) & tempTsv & Chr$(34) & _
        " --batch-bridge --batch-target-year " & _
        CStr(CLng(ThisWorkbook.Worksheets("操作画面").Range("B4").Value2))
    code = shell.Run(cmd, 0, True)
    If code <> 0 Or Not fso.FileExists(tempTsv) Then _
        Err.Raise vbObjectError + 377, , "一括自動参考額の読取に失敗しました。"
    count = LoadBatchFromTsv(tempTsv)
    If count < 1 Then Err.Raise vbObjectError + 378, , "読取ページがありません。"
    GoTo Clean
Failed:
    reason = Err.Description
    On Error Resume Next
    If Not fso Is Nothing Then
        If Len(tempTsv) > 0 Then
            If fso.FileExists(tempTsv) Then fso.DeleteFile tempTsv, True
        End If
    End If
    On Error GoTo 0
    Err.Raise vbObjectError + 379, "AutoImportAllPages", reason
Clean:
    On Error Resume Next
    If fso.FileExists(tempTsv) Then fso.DeleteFile tempTsv, True
End Sub

' Optional full-accuracy manual review from Macros dialog; not the default.
Public Sub ImportWithholdingDetailed()
    mManualImport = True
    ImportWithholding
    mManualImport = False
End Sub

' Strict Japanese municipality-only decoder; never write full addresses.
Private Function DecodeMunicipalityHint(ByVal encoded As String) As String
    Dim index As Long, point As Long
    If Len(encoded) < 4 Or Len(encoded) > 64 Or _
       Len(encoded) Mod 4 <> 0 Or encoded Like "*[!0-9A-F]*" Then
        Err.Raise vbObjectError + 366, , "受給者住所の市区町村候補コードが不正です。"
    End If
    For index = 1 To Len(encoded) Step 4
        point = CLng("&H0" & Mid$(encoded, index, 4))
        If Not ((point >= &H3040 And point <= &H30FF) Or _
                (point >= &H3400 And point <= &H9FFF) Or point = &H3005) Then
            Err.Raise vbObjectError + 367, , "市区町村候補に使用できない文字が含まれます。"
        End If
        DecodeMunicipalityHint = DecodeMunicipalityHint & ChrW$(point)
    Next index
End Function

' Import only allowlisted numeric fields from a local, explicitly selected file.
' Do not put names, addresses, tax IDs, or raw document text into the workbook.
' An immutable snapshot is saved before mutating a user's current input.
Public Sub ImportWithholding()
    Dim picked As Variant, fso As Object, shell As Object, reader As String
    Dim tempJson As String, tempTsv As String, command As String, line As String
    Dim inFile As Object, fields As Object, fragments As Variant
    Dim key As Variant, value As Double, year As Long, exitCode As Long
    Dim status As String, raw As String, backup As String, caution As String
    Dim home As Worksheet, extra As Worksheet, code As Long, problem As String
    Dim taxpayerChoice As VbMsgBoxResult, newTaxpayer As Boolean, isProjection As Boolean
    Dim pageChoice As Variant, pageCount As Long, pageArg As String
    Dim municipalityClass As String, municipalityName As String
    Dim municipalitySelected As String, residenceYear As Long
    Dim quick As Boolean, currentYear As Long
    On Error GoTo Failed
    quick = Not mManualImport
    ' Select the PDF-only filter initially. Compound patterns hid PDFs.
    picked = Application.GetOpenFilename( _
        "PDF (*.pdf),*.pdf,PNG,*.png,JPG,*.jpg,JPEG,*.jpeg," & _
        "WEBP,*.webp,TIF,*.tif,TIFF,*.tiff,BMP,*.bmp," & _
        "HEIC,*.heic,HEIF,*.heif,CSV,*.csv,TSV,*.tsv," & _
        "JSON,*.json,TXT,*.txt,すべてのファイル,*.*", _
        1, "源泉徴収票を選択")
    If VarType(picked) = vbBoolean Then Exit Sub
    If ThisWorkbook.ReadOnly Or Len(ThisWorkbook.Path) = 0 Then
        Err.Raise vbObjectError + 201, , "書き込み可能なブックをローカルに保存してから取込んでください。"
    End If
    currentYear = CLng(ThisWorkbook.Worksheets("操作画面").Range("B4").Value2)
    If currentYear <> 2025 And currentYear <> 2026 Then _
        Err.Raise vbObjectError + 375, , "計算対象年は2025/2026年に限ります。"
    Set fso = CreateObject("Scripting.FileSystemObject")
    reader = fso.BuildPath(ThisWorkbook.Path, "FurusatoDocumentReader.exe")
    If Not fso.FileExists(reader) Then
        Err.Raise vbObjectError + 202, , "読取EXEがありません。Windows用配布ZIPをすべて展開してください。Pythonのインストールは不要です。"
    End If
    command = Chr$(34) & reader & Chr$(34)
    Set shell = CreateObject("WScript.Shell")
    tempJson = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName & ".json")
    tempTsv = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName & ".tsv")
    ' Multiple taxpayers' withholding slips can be bundled in one PDF.
    ' Count-only mode does not scan or export personal data. The operator
    ' MUST select one numbered page; never sum or guess across pages.
    If LCase$(fso.GetExtensionName(CStr(picked))) = "pdf" Then
        command = Chr$(34) & reader & Chr$(34) & _
                  " --input " & Chr$(34) & CStr(picked) & Chr$(34) & _
                  " --output " & Chr$(34) & tempJson & Chr$(34) & " --page-count"
        exitCode = shell.Run(command, 0, True)
        If exitCode <> 0 Or Not fso.FileExists(tempJson) Then _
            Err.Raise vbObjectError + 256, , "PDFのページ数を確認できません。"
        Set inFile = fso.OpenTextFile(tempJson, 1, False, 0)
        raw = Trim$(inFile.ReadAll)
        inFile.Close
        Set inFile = Nothing
        If Not IsNumeric(raw) Then _
            Err.Raise vbObjectError + 257, , "PDFページ数の検証情報が不正です。"
        If CDbl(raw) < 1 Or CDbl(raw) > 100 Or CDbl(raw) <> Fix(CDbl(raw)) Then _
            Err.Raise vbObjectError + 258, , "PDFは1～100ページで指定してください。"
        pageCount = CLng(raw)
        If pageCount > 1 Then
            If quick Then
                AutoImportAllPages CStr(picked), reader
                GoTo CleanUp
            End If
            pageChoice = Application.InputBox( _
                "PDFに " & CStr(pageCount) & " ページあります。" & vbCrLf & _
                "取り込む納税者のページ番号を入力してください（1～" & _
                CStr(pageCount) & "）。" & vbCrLf & _
                "このExcelは1納税者1案件です。" & vbCrLf & _
                "ほかのページの金額は合算しません。各人の案件を保存後、" & _
                "別ページを新しい案件へ取り込んでください。", _
                "源泉徴収票のページ選択", Type:=1)
            If VarType(pageChoice) = vbBoolean Then GoTo CleanUp
            If Not IsNumeric(pageChoice) Then _
                Err.Raise vbObjectError + 259, , "PDFページ番号を確認してください。"
            If CDbl(pageChoice) < 1 Or CDbl(pageChoice) > pageCount Or _
               CDbl(pageChoice) <> Fix(CDbl(pageChoice)) Then _
                Err.Raise vbObjectError + 260, , "PDFページ番号が範囲外です。"
            pageArg = " --page " & CStr(CLng(pageChoice))
        End If
    End If
    command = Chr$(34) & reader & Chr$(34) & _
              " --input " & Chr$(34) & CStr(picked) & Chr$(34) & _
              " --output " & Chr$(34) & tempJson & Chr$(34) & _
              " --bridge " & Chr$(34) & tempTsv & Chr$(34) & pageArg
    If quick Then command = command & " --auto-reference-year " & CStr(currentYear)
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
    If status <> "READY_FOR_EXCEL_CROSSCHECK" And status <> "REQUIRES_REVIEW" Then
        Err.Raise vbObjectError + 207, , "読取状態が不正です。"
    End If
    If Not IsNumeric(fields("YEAR")) Then _
        Err.Raise vbObjectError + 208, , _
            "所得年を認識できません。源泉徴収票上部の「令和○年分」を確認してください。" & vbCrLf & _
            "印字があってもPDFの文字レイヤーが特殊な場合、読取不能となることがあります。"
    year = CLng(fields("YEAR"))
    ' CLng can silently round 2025.6 to 2026. A bridge year must be
    ' exactly the decimal integer string approved by the local reader.
    If Trim$(CStr(fields("YEAR"))) <> CStr(year) Then
        Err.Raise vbObjectError + 276, , "所得年の形式が整数ではありません。"
    End If
    If year <> 2025 And year <> 2026 Then Err.Raise vbObjectError + 209, , "未承認の年分です。"
    If fields.Exists("MUNI_CLASS") <> fields.Exists("MUNI_NAME_HEX") Then
        Err.Raise vbObjectError + 368, , "市区町村候補の項目が不完全です。"
    End If
    If fields.Exists("MUNI_CLASS") Then
        municipalityClass = CStr(fields("MUNI_CLASS"))
        Select Case municipalityClass
            Case "STANDARD", "DESIGNATED", "SPECIAL"
            Case Else
                Err.Raise vbObjectError + 369, , "市区町村候補の区分が不正です。"
        End Select
        municipalityName = DecodeMunicipalityHint(CStr(fields("MUNI_NAME_HEX")))
    End If
    If quick Then
        If Not fields.Exists("AUTO_STATUS") Then _
            Err.Raise vbObjectError + 370, , "自動参考額の検証情報がありません。"
        Select Case CStr(fields("AUTO_STATUS"))
            Case "HOLD"
                If fields.Exists("AUTO_LIMIT") Then _
                    Err.Raise vbObjectError + 371, , "保留に金額は設定できません。"
            Case "AUTO_REFERENCE"
                If Not fields.Exists("AUTO_SCOPE") Or _
                    Not fields.Exists("AUTO_LIMIT") Or _
                    Not fields.Exists("AUTO_YEAR") Or _
                    Not fields.Exists("AUTO_WARNINGS") Then _
                    Err.Raise vbObjectError + 372, , "自動参考額の項目が不完全です。"
                If CStr(fields("AUTO_SCOPE")) <> "UNVERIFIED_SOURCE_ONLY" Then _
                    Err.Raise vbObjectError + 373, , "参考額は未確定である必要があります。"
                If CStr(fields("AUTO_YEAR")) <> CStr(currentYear) Then _
                    Err.Raise vbObjectError + 374, , "参考額の対象所得年が異なります。"
                If Len(CStr(fields("AUTO_WARNINGS"))) > 230 Or _
                    CStr(fields("AUTO_WARNINGS")) Like "*[!A-Z_0-9;]*" Then _
                    Err.Raise vbObjectError + 376, , "参考額の注意コードが不正です。"
            Case Else
                Err.Raise vbObjectError + 380, , "自動参考額の区分が不正です。"
        End Select
    End If
    ' Preserve the selected calculation year. In a 2025-source/2026-target
    ' projection the prior document year must never overwrite target 2026.
    Set home = ThisWorkbook.Worksheets("操作画面")
    If Not IsNumeric(home.Range("B4").Value2) Then _
        Err.Raise vbObjectError + 283, , "計算対象年が不正です。"
    isProjection = (year = 2025 And CLng(home.Range("B4").Value2) = 2026)
    For Each key In Array("salary_gross", "income_tax_withheld", "social_insurance")
        If Not fields.Exists(CStr(key)) Then
            Err.Raise vbObjectError + 210, , "必須の支払金額・源泉税・社会保険料が読み取れていません。"
        End If
    Next key
    For Each key In fields.Keys
        If key <> "STATUS" And key <> "YEAR" And key <> "WARNINGS" And _
           key <> "MUNI_CLASS" And key <> "MUNI_NAME_HEX" And _
           key <> "AUTO_STATUS" And key <> "AUTO_SCOPE" And _
           key <> "AUTO_LIMIT" And key <> "AUTO_YEAR" And _
           key <> "AUTO_WARNINGS" Then
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
                     "mortgage_claim_count", "basic_reference", "income_adjustment", _
                     "under16_count", "special_relative_count", _
                     "special_relative_deduction_reference", _
                     "spouse_income_reference"
                    ' Allowed amounts only; all other columns are rejected.
                Case Else
                    Err.Raise vbObjectError + 213, , "未承認の取込項目を検出しました。"
            End Select
        End If
    Next key
    caution = "源泉徴収票の読み取れた数値を転記し、現在の入力を置換しますか？" & vbCrLf & _
              "既存データはバックアップします。"
    If isProjection Then
        caution = caution & vbCrLf & vbCrLf & _
            "令和7年の原票を令和8年の試算に利用します。" & vbCrLf & _
            "令和7年の給与所得・所得控除合計・源泉税額は参考値です。" & vbCrLf & _
            "令和8年の給与・基礎控除・扶養等を再計算し、試算条件の手動確認が必要です。" & vbCrLf & _
            "前年分の追加所得が翌年へ混入しないよう、年金・事業・雑所得・分離所得を初期化します。"
    End If
    If pageCount > 1 Then
        caution = caution & vbCrLf & "対象：PDFの" & _
                  CStr(CLng(pageChoice)) & "／" & CStr(pageCount) & _
                  "ページ目のみ（他のページは取り込みません）。"
    End If
    If status = "REQUIRES_REVIEW" Then
        caution = caution & vbCrLf & vbCrLf & _
              "このPDFは一部項目が未確定です。読み取れた数値だけを仮転記します。" & vbCrLf & _
              "原票照合を完了するまで寄附限度額の確定表示は停止します。"
    End If
    If Not quick Then
        If MsgBox(caution, vbQuestion + vbYesNo + vbDefaultButton2) <> vbYes Then GoTo CleanUp
    End If
    ' A source PDF has no trusted taxpayer identity in its ASCII-only bridge.
    ' Do not silently carry a former taxpayer's pension, business, capital
    ' gains or other additional income into a new taxpayer's calculation.
    If quick Then
        ' Always start an isolated source-only case after an automatic backup;
        ' never inherit old customers' pension, business or confirmation data.
        newTaxpayer = True
    Else
        taxpayerChoice = MsgBox( _
            "別の納税者の源泉徴収票を取り込みますか？" & vbCrLf & vbCrLf & _
            "はい：別の納税者。年金・事業・雑所得・分離課税所得も初期化します。" & vbCrLf & _
            "いいえ：同じ納税者の再取込。追加所得の入力は維持します。" & vbCrLf & _
            "キャンセル：取込を中止します。", _
            vbQuestion + vbYesNoCancel + vbDefaultButton3, "納税者の切替確認")
        If taxpayerChoice = vbCancel Then GoTo CleanUp
        newTaxpayer = ImportMustResetAdditionalIncome(year, taxpayerChoice = vbYes)
        If newTaxpayer And taxpayerChoice = vbNo Then
            MsgBox "所得年が異なるため、前年の追加所得を初期化します。", vbExclamation
        End If
    End If
    ' A withholding slip's creation-date address does not prove the
    ' statutory January 1 domicile of the target resident-tax year.
    municipalitySelected = "条例差・不明"
    residenceYear = CLng(home.Range("B4").Value2) + 1
    If Len(municipalityName) > 0 Then
        Select Case municipalityClass
            Case "STANDARD": municipalitySelected = "標準市町村"
            Case "DESIGNATED": municipalitySelected = "標準指定都市"
            Case "SPECIAL": municipalitySelected = "条例差・不明"
        End Select
        If quick Then
            ' Candidate municipality is a hypothesis; no January 1 attestation.
            municipalitySelected = "条例差・不明"
        ElseIf municipalityClass = "SPECIAL" Then
            MsgBox "源泉票の受給者住所から「" & municipalityName & "」を検出しました。" & vbCrLf & _
                   "標準税率と異なる自治体のため試算を停止します。" & vbCrLf & _
                   "個別の税率・条例を確認してください。", vbExclamation, "課税自治体の要確認"
        Else
            If MsgBox("源泉徴収票の受給者住所からの候補：" & municipalityName & _
                "（" & municipalitySelected & "）" & vbCrLf & _
                "※支払者（勤務先）の住所ではありません。" & vbCrLf & vbCrLf & _
                CStr(residenceYear) & "年1月1日の住所地" & _
                IIf(Date < DateSerial(residenceYear, 1, 1), _
                    "（将来のため見込み）", "（実績）") & _
                "がこの自治体で、標準の所得割税率を適用できると確認しましたか？" & vbCrLf & _
                "はいでも将来の転居・条例変更は別途再確認が必要です。" & vbCrLf & _
                "いいえ：不明として計算を保留します。", _
                vbYesNo + vbQuestion + vbDefaultButton2, "課税自治体の候補確認") <> vbYes Then
                municipalitySelected = "条例差・不明"
            End If
        End If
    ElseIf Not quick Then
        MsgBox "受給者住所から市区町村を確実に判定できませんでした。" & vbCrLf & _
            "課税年度1月1日の住所地・条例を確認し、詳細設定D51で選択してください。", _
            vbExclamation, "課税自治体の要確認"
    End If
    backup = UniqueBackupPath(ThisWorkbook)
    ThisWorkbook.SaveCopyAs backup
    If Not fso.FileExists(backup) Then Err.Raise vbObjectError + 214, , "更新前のバックアップを作成できません。"
    Set home = ThisWorkbook.Worksheets("操作画面")
    Set extra = ThisWorkbook.Worksheets("例外・分離課税")
    ResetSeparateInputs home
    ResetRelativeInputs
    PrepareAdditionalIncomeForImport extra, newTaxpayer
    home.Range("D51").Value2 = municipalitySelected
    home.Range("F51").Value2 = municipalityName ' municipality only; no street details
    home.Range("D33,B11:B12,B15:B16,B19:B25,B33:B36,D11:D23,D25").ClearContents
    ' Leave independent pension, business and other income entries untouched.
    extra.Range("B13:B20").ClearContents
    extra.Range("B38:B40").ClearContents
    extra.Range("B43:B44").ClearContents
    extra.Range("B45:B49").ClearContents ' discard prior source-only estimate
    extra.Range("B41").ClearContents ' Replacing source invalidates any prior attestation.
    extra.Range("B32").ClearContents
    ' B4 and home B26 are calculated indicators: never overwrite formulas.
    home.Range("B25").Value2 = "なし"
    home.Range("D33").Value2 = "未確認"
    home.Range("D22").Value2 = "該当なし"
    home.Range("D24").Value2 = "ワンストップ"
    ' B4 selects the tax law; B11 identifies the imported source slip.
    ' Changing B4 here would destroy 2025->2026 projection intent.
    home.Range("B11").Value2 = year
    For Each key In fields.Keys
        If key <> "STATUS" And key <> "YEAR" And key <> "WARNINGS" And _
           key <> "MUNI_CLASS" And key <> "MUNI_NAME_HEX" And _
           key <> "AUTO_STATUS" And key <> "AUTO_SCOPE" And _
           key <> "AUTO_LIMIT" And key <> "AUTO_YEAR" And _
           key <> "AUTO_WARNINGS" Then
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
                Case "mortgage_credit":
                    extra.Range("B43").Value2 = value
                    If Not isProjection Then home.Range("B33").Value2 = value
                Case "mortgage_possible_credit":
                    extra.Range("B44").Value2 = value
                    If Not isProjection Then home.Range("B34").Value2 = value
                Case "mortgage_occupancy_year":
                    If Not isProjection Then home.Range("B35").Value2 = value
                Case "mortgage_claim_count":
                    If Not isProjection Then home.Range("B36").Value2 = value
                Case "under16_count":
                    home.Range("D23").Value2 = value
                    If value > 0 Then home.Range("B25").Value2 = "あり"
                Case "income_adjustment": extra.Range("B13").Value2 = value
                Case "special_relative_count": extra.Range("B38").Value2 = value
                Case "special_relative_deduction_reference": extra.Range("B39").Value2 = value
                Case "spouse_income_reference": extra.Range("B40").Value2 = value
            End Select
        End If
    Next key
    ' Housing credit is a routine on-sheet input, not an advanced-case switch.
    ' The sheet formula still blocks missing applied amounts or unsupported years.
    extra.Range("B19").Value2 = "ローカル・項目コード照合"
    extra.Range("B20").Value2 = status
    If fields.Exists("WARNINGS") Then extra.Range("B32").Value2 = fields("WARNINGS")
    If pageCount > 1 Then
        extra.Range("B32").Value2 = CStr(extra.Range("B32").Value2) & _
            ";SELECTED_PDF_PAGE_" & CStr(CLng(pageChoice)) & "_OF_" & CStr(pageCount)
    End If
    If quick And CStr(fields("AUTO_STATUS")) = "AUTO_REFERENCE" Then
        raw = CStr(fields("AUTO_LIMIT"))
        If Len(raw) = 0 Or raw Like "*[!0-9]*" Then _
            Err.Raise vbObjectError + 381, , "自動参考額が整数ではありません。"
        If CDbl(raw) < 0 Or CDbl(raw) > 1000000000# Or _
           CDbl(raw) <> Fix(CDbl(raw)) Then _
            Err.Raise vbObjectError + 382, , "自動参考額の範囲外です。"
        extra.Range("B45").Value2 = CDbl(raw)
        extra.Range("B46").Value2 = "AUTO_REFERENCE"
        extra.Range("B47").Value2 = currentYear
        extra.Range("B48").Value2 = CStr(fields("AUTO_WARNINGS"))
    End If
    Application.Calculate
    If quick Then
        If CStr(extra.Range("B46").Value2) = "AUTO_REFERENCE" Then
            If Len(CStr(extra.Range("B42").Value2)) = 0 Then _
                Err.Raise vbObjectError + 383, , "参照元の状態を固定できません。"
            extra.Range("B49").Value2 = CStr(extra.Range("B42").Value2)
        End If
        Application.Calculate
        RevealVerifiedResults
        home.Activate
        home.Range("A1").Select
    ElseIf status = "REQUIRES_REVIEW" Then
        MsgBox "読み取れた金額を仮転記しました（未確定）。" & vbCrLf & _
               "空欄・不一致を源泉徴収票と照合した後「読取内容の確認」を押してください。" & vbCrLf & _
               "住宅ローン控除可能額は所得税適用額と別項目です。", vbExclamation
    Else
        MsgBox "源泉徴収票の数値を転記しました。控除・扶養などを確認してください。", vbInformation
    End If
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

' Provisional imports are editable, but never silently treated as tax-complete.
' The user must confirm the missing mortgage credit applied amount and the
' source reference amounts before a previously flagged import is released.
' Apply the published 2025/2026 income-tax G74 special-relative bands.
' The threshold changed from 580,000 to 620,000 for the 2026 income year.
Public Function SpecialRelativeTaxDeduction(ByVal familyIncome As Double, ByVal incomeYear As Long) As Double
    Dim minimum As Double
    If incomeYear = 2025 Then
        minimum = 580000#
    ElseIf incomeYear = 2026 Then
        minimum = 620000#
    Else
        SpecialRelativeTaxDeduction = 0#
        Exit Function
    End If
    If familyIncome <= minimum Or familyIncome > 1230000# Then
        SpecialRelativeTaxDeduction = 0#
    ElseIf familyIncome <= 850000# Then
        SpecialRelativeTaxDeduction = 630000#
    ElseIf familyIncome <= 900000# Then
        SpecialRelativeTaxDeduction = 610000#
    ElseIf familyIncome <= 950000# Then
        SpecialRelativeTaxDeduction = 510000#
    ElseIf familyIncome <= 1000000# Then
        SpecialRelativeTaxDeduction = 410000#
    ElseIf familyIncome <= 1050000# Then
        SpecialRelativeTaxDeduction = 310000#
    ElseIf familyIncome <= 1100000# Then
        SpecialRelativeTaxDeduction = 210000#
    ElseIf familyIncome <= 1150000# Then
        SpecialRelativeTaxDeduction = 110000#
    ElseIf familyIncome <= 1200000# Then
        SpecialRelativeTaxDeduction = 60000#
    Else
        SpecialRelativeTaxDeduction = 30000#
    End If
End Function

' G43 is a source income reference, not a spouse age determination.
Private Sub ValidateSpouseSource(ByVal home As Worksheet, ByVal extra As Worksheet)
    Dim raw As Variant, ordinary As Variant, elderly As Variant
    Dim hasOrdinary As Boolean, hasElderly As Boolean
    raw = extra.Range("B40").Value2
    If Len(Trim$(CStr(raw))) = 0 Then Exit Sub
    If Not IsNumeric(raw) Then _
        Err.Raise vbObjectError + 277, , "源泉票G43の配偶者所得額が不正です。"
    If CDbl(raw) < 0# Or CDbl(raw) <> Fix(CDbl(raw)) Then _
        Err.Raise vbObjectError + 277, , "源泉票G43の配偶者所得額が不正です。"
    ordinary = home.Range("D17").Value2
    elderly = home.Range("D18").Value2
    hasOrdinary = Len(Trim$(CStr(ordinary))) > 0
    hasElderly = Len(Trim$(CStr(elderly))) > 0
    If hasOrdinary = hasElderly Then _
        Err.Raise vbObjectError + 278, , "配偶者の年齢区分を確認してD17またはD18に1件だけ入力してください。"
    If hasOrdinary Then
        If Not IsNumeric(ordinary) Then _
            Err.Raise vbObjectError + 279, , "一般配偶者の所得金額が不正です。"
        If CDbl(ordinary) <> CDbl(raw) Then _
            Err.Raise vbObjectError + 280, , "配偶者所得が源泉票G43と一致しません。"
    Else
        If Not IsNumeric(elderly) Then _
            Err.Raise vbObjectError + 281, , "老人配偶者の所得金額が不正です。"
        If CDbl(elderly) <> CDbl(raw) Then _
            Err.Raise vbObjectError + 282, , "配偶者所得が源泉票G43と一致しません。"
    End If
End Sub

' Review-only QA endpoint, never changes the signed source state.
Public Function SpouseSourceCheckForTest() As String
    On Error GoTo Rejected
    Application.Calculate
    ValidateSpouseSource ThisWorkbook.Worksheets("操作画面"), _
        ThisWorkbook.Worksheets("例外・分離課税")
    SpouseSourceCheckForTest = "OK"
    Exit Function
Rejected:
    SpouseSourceCheckForTest = "ERROR: " & Err.Description
End Function

' Validate the source count and source amount against *each* relative.
' Both the visible review UI and non-dialog Windows regression call this
' one implementation; tests must not simulate verification by forging B41.
Private Sub ValidateSpecialRelativeSource(ByVal home As Worksheet, _
                                          ByVal extra As Worksheet, _
                                          ByVal relatives As Worksheet)
    Dim row As Long, sourceCount As Long, actualCount As Long
    Dim sourceAmount As Double, actualAmount As Double
    Dim sourceCountRaw As Variant, sourceAmountRaw As Variant
    Dim currentIncome As Double, statutory As Double
    Dim category As String
    Dim hasSourceCount As Boolean, hasSourceAmount As Boolean

    sourceCountRaw = extra.Range("B38").Value2
    sourceAmountRaw = extra.Range("B39").Value2
    hasSourceCount = Len(Trim$(CStr(sourceCountRaw))) > 0
    hasSourceAmount = Len(Trim$(CStr(sourceAmountRaw))) > 0
    If hasSourceCount Then
        If Not IsNumeric(sourceCountRaw) Then _
            Err.Raise vbObjectError + 244, , "特定親族の人数（G72）が数値ではありません。"
        If CDbl(sourceCountRaw) < 0# Or CDbl(sourceCountRaw) > 5# Or _
           CDbl(sourceCountRaw) <> Fix(CDbl(sourceCountRaw)) Then _
            Err.Raise vbObjectError + 251, , "特定親族の人数（G72）が入力上限または整数条件に合致しません。"
        sourceCount = CLng(sourceCountRaw)
    End If
    If hasSourceAmount Then
        If Not IsNumeric(sourceAmountRaw) Then _
            Err.Raise vbObjectError + 245, , "特定親族特別控除額（G74）が数値ではありません。"
        If CDbl(sourceAmountRaw) < 0# Or _
           CDbl(sourceAmountRaw) <> Fix(CDbl(sourceAmountRaw)) Then _
            Err.Raise vbObjectError + 252, , "特定親族特別控除額（G74）は非負の整数で入力してください。"
        sourceAmount = CDbl(sourceAmountRaw)
    End If
    If sourceAmount > 0# And sourceCount = 0 Then _
        Err.Raise vbObjectError + 244, , "特定親族の人数（G72）が原票から読み取れていません。"
    ' Distinguish an absent G72/G74 from an explicitly extracted zero.
    ' G72=0 MUST NOT bypass checking income entries that classify as
    ' special-relative deductions.  It is an assertion that count = zero.
    If Not hasSourceCount And Not hasSourceAmount Then Exit Sub
    If sourceCount > 0 And Not hasSourceAmount Then _
        Err.Raise vbObjectError + 245, , "特定親族特別控除額（G74）を確認してください。"

    For row = 4 To 8
        category = CStr(relatives.Cells(row, "G").Value2)
        If category = "要確認" Then _
            Err.Raise vbObjectError + 253, , "特定親族の年齢・各人所得・要件に未確認があります。"
        If category = "特定親族特別控除" Then
            currentIncome = CDbl(relatives.Cells(row, "C").Value2)
            statutory = SpecialRelativeTaxDeduction( _
                currentIncome, CLng(home.Range("B11").Value2))
            If statutory <> CDbl(relatives.Cells(row, "E").Value2) Then _
                Err.Raise vbObjectError + 250, , "特定親族の個別控除額と所得税の法定表が一致しません。"
            actualCount = actualCount + 1
            actualAmount = actualAmount + statutory
        End If
    Next row
    If actualCount <> sourceCount Then _
        Err.Raise vbObjectError + 246, , "特定親族の合計所得を人数分入力し、原票と照合してください。"
    If actualAmount <> sourceAmount Then _
        Err.Raise vbObjectError + 247, , "特定親族特別控除額（G74）と所得内訳の計算が一致しません。"
End Sub

' Modal-free source reconciliation for disposable COM QA only.
' Read-only; cannot accept/release an import or modify the verification stamp.
Public Function SpecialRelativeSourceCheckForTest() As String
    On Error GoTo Invalid
    Application.Calculate
    ValidateSpecialRelativeSource ThisWorkbook.Worksheets("操作画面"), _
        ThisWorkbook.Worksheets("例外・分離課税"), _
        ThisWorkbook.Worksheets("特定親族明細")
    SpecialRelativeSourceCheckForTest = "OK"
    Exit Function
Invalid:
    SpecialRelativeSourceCheckForTest = "ERROR: " & Err.Description
End Function

Public Sub ReviewWithholding()
    Dim home As Worksheet, extra As Worksheet, relatives As Worksheet, msg As String
    Dim value As Double, refCell As Variant, calcCell As Variant
    Dim sourceTotalDifferent As Boolean, isProjection As Boolean
    On Error GoTo Failed
    Set home = ThisWorkbook.Worksheets("操作画面")
    Set extra = ThisWorkbook.Worksheets("例外・分離課税")
    Set relatives = ThisWorkbook.Worksheets("特定親族明細")
    ' Some warnings denote an unsupported statutory scenario, not merely
    ' a transcription needing manual confirmation. Never allow the review
    ' button to convert such cases into an approved monetary estimate.
    If InStr(1, CStr(extra.Range("B32").Value2), "UNSUPPORTED_", vbTextCompare) > 0 Then
        Err.Raise vbObjectError + 275, , "未対応の特定親族等の項目があります。対象条件は計算対象外です。"
    End If
    Application.Calculate
    isProjection = (Val(CStr(home.Range("B11").Value2)) = 2025 And _
                    Val(CStr(home.Range("D4").Value2)) = 2026)
    If isProjection Then
        If CStr(home.Range("D33").Value2) <> "確認済" And _
           CStr(home.Range("D33").Value2) <> "住宅控除なし" Then
            Err.Raise vbObjectError + 284, , _
                "翌年試算の給与・社会保険料・扶養・当年住宅ローン控除を確認し、操作画面D33で条件を確定してください。"
        End If
        ' "No mortgage credit" is an assertion about the target year
        ' even when the prior-year slip has NO mortgage credit at all.
        ' Reject every nonblank current-year amount, including a pasted
        ' string or an explicit zero; the mutually exclusive inputs must
        ' instead be cleared before this review can be accepted.
        If CStr(home.Range("D33").Value2) = "住宅控除なし" And _
            (Len(Trim$(CStr(home.Range("B33").Value2))) > 0 Or _
             Len(Trim$(CStr(home.Range("B34").Value2))) > 0) Then
            Err.Raise vbObjectError + 286, , _
                "住宅控除なしを選んだ場合は当年の住宅ローン控除額・可能額を空欄にしてください。"
        End If
        If CDbl(Val(CStr(extra.Range("B43").Value2))) > 0# Or _
           CDbl(Val(CStr(extra.Range("B44").Value2))) > 0# Then
            If CStr(home.Range("D33").Value2) = "確認済" And _
               Val(CStr(home.Range("B34").Value2)) <= 0 Then
                Err.Raise vbObjectError + 285, , _
                    "原票に前年の住宅ローン控除があります。当年の適用額・可能額・入居年を入力するか、住宅控除なしを確認してください。"
            End If
        End If
    End If
    sourceTotalDifferent = False
    If IsNumeric(extra.Range("B14").Value2) And IsNumeric(home.Range("B31").Value2) Then
        sourceTotalDifferent = Abs(CDbl(extra.Range("B14").Value2) - _
                                   CDbl(home.Range("B31").Value2)) > 1
    End If
    If CStr(extra.Range("B20").Value2) <> "REQUIRES_REVIEW" And _
       Not sourceTotalDifferent And Not isProjection And _
       Len(Trim$(CStr(home.Range("D25").Value2))) = 0 And _
       Len(Trim$(CStr(extra.Range("B38").Value2))) = 0 And _
       Len(Trim$(CStr(extra.Range("B39").Value2))) = 0 And _
       Not (CStr(extra.Range("B20").Value2) = "VERIFIED_AFTER_CORRECTION" And _
            (Len(CStr(extra.Range("B41").Value2)) = 0 Or _
             CStr(extra.Range("B41").Value2) <> CStr(extra.Range("B42").Value2))) Then
        MsgBox "源泉徴収票の仮転記に未確認項目はありません。", vbInformation
        Exit Sub
    End If
    If Not IsNumeric(home.Range("B12").Value2) Or _
       Not IsNumeric(home.Range("B15").Value2) Or _
       Not IsNumeric(home.Range("B16").Value2) Then
        Err.Raise vbObjectError + 240, , "支払額・源泉徴収税額・社会保険料を確認してください。"
    End If
    If IsNumeric(home.Range("B34").Value2) Then
        If CDbl(home.Range("B34").Value2) > 0 Then
            If Not IsNumeric(home.Range("B33").Value2) Or _
               Not IsNumeric(home.Range("B35").Value2) Or _
               Not IsNumeric(home.Range("B36").Value2) Then
                Err.Raise vbObjectError + 241, , "住宅ローン控除の所得税適用額・居住開始年・適用数を確認してください。"
            End If
        End If
    End If
    ' These fields certify the original document year. The target year's
    ' spouse/relative eligibility and deductions can legitimately differ.
    ' D33 and the exact stamped inputs are required before a projection.
    If Not isProjection Then
        ValidateSpouseSource home, extra
        ValidateSpecialRelativeSource home, extra, relatives
    End If
    Application.Calculate
    If Len(Trim$(CStr(home.Range("D25").Value2))) > 0 Then
        If MsgBox("所得控除合計は手入力上書き中です。" & vbCrLf & _
           "社会保険料・扶養・本人所得などの変更に自動追随しません。" & vbCrLf & _
           "自動算定額と原票額を確認し、上書きを維持しますか？", _
           vbExclamation + vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    End If
    For Each refCell In Array("B14", "B15", "B16", "B17")
        Select Case CStr(refCell)
            Case "B14": Set calcCell = home.Range("B14")
            Case "B15": Set calcCell = home.Range("B13")
            Case "B16": Set calcCell = home.Range("B17")
            Case "B17": Set calcCell = home.Range("B18")
        End Select
        If IsNumeric(extra.Range(CStr(refCell)).Value2) And _
           (Not isProjection Or CStr(refCell) = "B14") And _
           Not (CStr(refCell) = "B14" And _
           Len(Trim$(CStr(home.Range("D25").Value2))) > 0) Then
            If Not IsNumeric(calcCell.Value2) Then
                Err.Raise vbObjectError + 242, , "自動控除額を算定できません。"
            End If
            If Abs(CDbl(extra.Range(CStr(refCell)).Value2) - CDbl(calcCell.Value2)) > 1 Then
                If CStr(refCell) = "B14" Then
                    ' Source total is retained for audit; it cannot veto a
                    ' tax-year projection after explicit detailed review.
                    sourceTotalDifferent = True
                Else
                    Err.Raise vbObjectError + 243, , "源泉徴収票の金額と自動計算に差があります。控除内訳を見直してください。"
                End If
            End If
        End If
        Set calcCell = Nothing
    Next refCell
    If (sourceTotalDifferent Or isProjection) And _
       Len(Trim$(CStr(home.Range("D25").Value2))) = 0 Then
        If MsgBox("源泉徴収票の所得控除合計は原票年の参考額です。" & vbCrLf & _
           "適用年の税制・給与・保険料・扶養・配偶者等に" & _
           "基づく自動算定額を使用します。" & vbCrLf & _
           "控除の漏れや対象年の変更がないことを原票・証憑で確認しましたか？", _
           vbExclamation + vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    End If
    If MsgBox("源泉徴収票の未確認項目を確認しましたか？" & vbCrLf & _
              "読取結果を照合済みにします。", vbQuestion + vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    ' Bind the attestation to the actual, reviewed numerical input state.
    ' Never preserve a prior taxpayer's confirmation or silently reuse it
    ' after correcting social, spouse, relative, other income or source data.
    If IsError(extra.Range("B42").Value2) Then _
        Err.Raise vbObjectError + 248, , "確認対象の入力値を確定できません。"
    If Len(CStr(extra.Range("B42").Value2)) = 0 Then _
        Err.Raise vbObjectError + 249, , "入力内容の確認署名が空欄です。"
    extra.Range("B41").Value2 = CStr(extra.Range("B42").Value2)
    extra.Range("B20").Value2 = "VERIFIED_AFTER_CORRECTION"
    Application.Calculate
    MsgBox "原票照合状態を更新しました。入力値を変更すると確認は失効し再確認が必要です。未対応案件は引き続き限度額を表示しません。", vbInformation
    Exit Sub
Failed:
    msg = Err.Description
    MsgBox msg, vbExclamation, "読取内容の確認"
End Sub

Public Sub RecalculateCase()
    MaskUnverifiedResults
    ' Optional blanks are not errors. Only when explicitly recalculating,
    ' normalize the categorical fields to their conventional default values.
    Dim home As Worksheet
    Set home = ThisWorkbook.Worksheets("操作画面")
    If Trim$(CStr(home.Range("B11").Value2)) = "" Then
        home.Range("B11").Value2 = home.Range("B4").Value2
    End If
    If Trim$(CStr(home.Range("B25").Value2)) = "" Then home.Range("B25").Value2 = "なし"
    ' Home B26 is a read-only formula; nothing to normalize.
    If Trim$(CStr(home.Range("D22").Value2)) = "" Then home.Range("D22").Value2 = "該当なし"
    If Trim$(CStr(home.Range("D24").Value2)) = "" Then home.Range("D24").Value2 = "ワンストップ"
    ' One-stop donations are invalid if split income is declared on a return.
    If IsNumeric(ThisWorkbook.Worksheets("例外・分離課税").Range("B24").Value2) Then
        If CDbl(ThisWorkbook.Worksheets("例外・分離課税").Range("B24").Value2) > 0 Then
            home.Range("D24").Value2 = "確定申告"
        End If
    End If
    Application.Calculate
    RevealVerifiedResults
End Sub

' Remove case-specific confirmations and additional persons at import/new case.
' Never carry independently entered pension, business, miscellaneous or
' split income from a SOURCE year's slip into a different TARGET year.
' The source document year alone cannot attest the applicable year of
' manually entered other income. All projection imports reset these
' inputs, even if the same taxpayer/same old slip is reimported; a local
' backup precedes the reset, and the target-year numbers must be reentered.
Private Function ImportMustResetAdditionalIncome(ByVal sourceYear As Long, _
    ByVal isDifferentTaxpayer As Boolean) As Boolean
    Dim home As Worksheet
    Set home = ThisWorkbook.Worksheets("操作画面")
    ImportMustResetAdditionalIncome = isDifferentTaxpayer Or _
        CStr(home.Range("B11").Value2) <> CStr(sourceYear) Or _
        CStr(home.Range("B4").Value2) <> CStr(sourceYear) Or _
        CStr(home.Range("D4").Value2) <> CStr(sourceYear)
End Function

' Modal-free QA for the exact import decision. Only disposable CI workbook.
Public Function ImportResetDecisionForTest(ByVal sourceYear As Long, _
    ByVal isDifferentTaxpayer As Boolean) As Boolean
    If StrComp(ThisWorkbook.Name, "FurusatoQA.xlsm", vbTextCompare) <> 0 Then _
        Err.Raise vbObjectError + 255, , "検証専用の処理です。"
    ImportResetDecisionForTest = ImportMustResetAdditionalIncome(sourceYear, isDifferentTaxpayer)
End Function

' Reset non-slip additional taxpayer inputs on taxpayer, source-year, or
' target-year changes. Same-year/same-taxpayer re-import may preserve
' separate inputs. A 2025-source/2026-target projection ALWAYS clears.
Private Sub PrepareAdditionalIncomeForImport(ByVal extra As Worksheet, _
                                             ByVal newTaxpayer As Boolean)
    If Not newTaxpayer Then Exit Sub
    extra.Range("B5:B6,B8:B12,B21,B24:B26,B33,B36").ClearContents
    extra.Range("B25").Value2 = "なし"
    extra.Range("B33").Value2 = "なし"
End Sub

' Isolated Excel runner contract. Refuse all ordinary distributed case files.
Public Function PrepareAdditionalIncomeForImportForTest( _
    ByVal newTaxpayer As Boolean) As Boolean
    If StrComp(ThisWorkbook.Name, "FurusatoQA.xlsm", vbTextCompare) <> 0 Then _
        Err.Raise vbObjectError + 254, , "検証専用の処理です。"
    PrepareAdditionalIncomeForImport _
        ThisWorkbook.Worksheets("例外・分離課税"), newTaxpayer
    PrepareAdditionalIncomeForImportForTest = True
End Function

Private Sub ResetRelativeInputs()
    Dim rel As Worksheet
    Set rel = ThisWorkbook.Worksheets("特定親族明細")
    rel.Range("B4:B8,C7:C8").ClearContents
    rel.Range("D4:D8").Value2 = "未確認"
End Sub

Private Function HasSeparateInputs(ByVal screen As Worksheet) As Boolean
    ' Keep case reset and print routing compatible with existing project copies.
    Select Case CStr(screen.Range("A42").Value2)
        Case "詳細設定 | 申告分離課税（検証版）", "詳細設定 | 課税自治体・申告分離課税（条件限定）"
            HasSeparateInputs = True
    End Select
End Function

Private Sub ResetSeparateInputs(ByVal home As Worksheet)
    If Not HasSeparateInputs(home) Then Exit Sub
    ' The 2022 eligibility attestation is case-specific; an imported PDF
    ' or NewCase must not inherit it from a previous taxpayer.
    home.Range("D35").Value2 = "未確認"
    home.Range("B44").Value2 = "給与・通常"
    home.Range("B45:B51,D45:D48").ClearContents
    home.Range("D44").Value2 = "確定申告"
    home.Range("D49").Value2 = "未確認"
    home.Range("D50").Value2 = 2026
    home.Range("D51").Value2 = "条例差・不明"
    home.Range("F51").ClearContents
    If CStr(home.Range("A71").Value2) = "詳細設定 | 税額控除（該当なしは0）" Then home.Range("D72:D77").Value2 = 0
End Sub

Public Sub NewCase()
    If MsgBox("現在の入力と複数人一覧を消去しますか？必要な内容は先に保存してください。", _
              vbQuestion + vbYesNo + vbDefaultButton2, "新規入力") <> vbYes Then Exit Sub
    ClearBatchOverview
    MaskUnverifiedResults
    ResetSeparateInputs ThisWorkbook.Worksheets("操作画面")
    ResetRelativeInputs
    With ThisWorkbook.Worksheets("操作画面")
        .Range("B11:B12,B15:B16,B19:B25,B33:B36,D11:D23,D25,D33").ClearContents
        .Range("B11").Value2 = .Range("B4").Value2
        .Range("D33").Value2 = "未確認"
        .Range("B25").Value2 = "なし"
        .Range("D22").Value2 = "該当なし"
        .Range("D24").Value2 = "ワンストップ"
    End With
    With ThisWorkbook.Worksheets("例外・分離課税")
        ' Preserve calculated cells B7/B22/B28-B30.
        .Range("B5:B6,B8:B12,B13:B21,B24:B26,B32,B36,B38:B39,B41").ClearContents
        .Range("B25").Value2 = "なし"
        .Range("B33").Value2 = "なし"
        ' B4 is calculated from B24, and must survive NewCase.
        .Range("B8").ClearContents
        .Range("B19:B20").ClearContents
        .Range("B40,B43:B44,B45:B49").ClearContents
    End With
    Application.Calculate
    RevealVerifiedResults
End Sub

' Save-copy core is shared between the UI and an isolated Windows acceptance test.
' Never overwrite an existing customer case, including a previous test run.
' Write into the SAME destination folder, verify it, and then rename.
' A failed Excel SaveCopyAs must never leave a half-written customer case.
Public Function SaveCaseToFile(ByVal destination As String) As Boolean
    Dim fso As Object, folder As String, temporary As String
    Dim i As Long, problem As String, errorCode As Long
    On Error GoTo Failed
    If BatchOverviewHasRecords() Then
        Err.Raise vbObjectError + 361, , _
            "複数人一覧の給与情報が個別案件に混入するため、保存を停止しました。先に「一覧消去」を実行してください。"
    End If
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
    Call RecalculateCase
    ThisWorkbook.Worksheets("操作画面").Activate
    ThisWorkbook.Worksheets("例外・分離課税").Visible = xlSheetVeryHidden
End Sub

Public Sub ShowDetails()
    Dim screen As Worksheet
    Set screen = ThisWorkbook.Worksheets("操作画面")
    If Not ResultsAreCurrent() Then
        MsgBox "計算未完了のため古い計算根拠は表示できません。自動計算に戻して再計算してください。", vbExclamation
        Exit Sub
    End If
    If SeparateMode(screen) Then
        Application.Goto screen.Range("A55"), True
        Exit Sub
    End If
    With ThisWorkbook.Worksheets("計算根拠")
        .Visible = xlSheetVisible
        .Activate
    End With
End Sub

Public Sub ReturnHome()
    ThisWorkbook.Worksheets("操作画面").Activate
    ThisWorkbook.Worksheets("計算根拠").Visible = xlSheetVeryHidden
End Sub

Private Function SeparateMode(ByVal screen As Worksheet) As Boolean
    SeparateMode = (HasSeparateInputs(screen) And _
                    CStr(screen.Range("B44").Value2) = "申告分離")
End Function

Private Sub CheckReportAvailable(ByVal screen As Worksheet)
    If Not ResultsAreCurrent() Then
        Err.Raise vbObjectError + 310, , "計算未完了です。古い結果は使用できません。自動計算に戻して再計算してください。"
    End If
    If SeparateMode(screen) Then
        If CStr(screen.Range("B55").Value2) <> "計算可能" Then
            Err.Raise vbObjectError + 111, , CStr(screen.Range("B55").Value2)
        End If
    ElseIf CStr(screen.Range("B28").Value2) <> "正常" Then
        Err.Raise vbObjectError + 111, , "入力と計算状態を確認してください。"
    End If
End Sub

Private Function DetailsPrintArea(ByVal screen As Worksheet) As String
    DetailsPrintArea = "$A$55:$D$70"
    If CStr(screen.Range("A71").Value2) <> "詳細設定 | 税額控除（該当なしは0）" Then Exit Function
    If Application.Sum(screen.Range("D74:D76")) > 0 Then
        DetailsPrintArea = DetailsPrintArea & ",$A$80:$D$93"
    End If
End Function

Public Sub PrintDetails()
    Dim screen As Worksheet, previousArea As String, areaChanged As Boolean
    Dim problem As String
    On Error GoTo Failed
    Application.Calculate
    RevealVerifiedResults
    Set screen = ThisWorkbook.Worksheets("操作画面")
    CheckReportAvailable screen
    If SeparateMode(screen) Then
        previousArea = screen.PageSetup.PrintArea
        screen.PageSetup.PrintArea = DetailsPrintArea(screen)
        areaChanged = True
        screen.PrintPreview
        screen.PageSetup.PrintArea = previousArea
    Else
        ShowDetails
        ThisWorkbook.Worksheets("計算根拠").PrintPreview
    End If
    Exit Sub
Failed:
    problem = Err.Description
    On Error Resume Next
    If areaChanged Then screen.PageSetup.PrintArea = previousArea
    On Error GoTo 0
    MsgBox problem, vbExclamation, "印刷"
End Sub

' PDF export is verified and staged exactly like case saving.
' The test calls this public entrypoint, not Excel's sheet export directly.
Public Function ExportDetailsToFile(ByVal destination As String) As Boolean
    Dim fso As Object, folder As String, temporary As String
    Dim i As Long, code As Long, problem As String, openedDetail As Boolean
    Dim screen As Worksheet, previousArea As String, areaChanged As Boolean
    On Error GoTo Failed
    Application.Calculate
    RevealVerifiedResults
    Set screen = ThisWorkbook.Worksheets("操作画面")
    CheckReportAvailable screen
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
    If SeparateMode(screen) Then
        previousArea = screen.PageSetup.PrintArea
        screen.PageSetup.PrintArea = DetailsPrintArea(screen)
        areaChanged = True
        screen.ExportAsFixedFormat Type:=xlTypePDF, Filename:=temporary
        screen.PageSetup.PrintArea = previousArea
        areaChanged = False
    Else
        If ThisWorkbook.Worksheets("計算根拠").Visible <> xlSheetVisible Then
            ShowDetails
            openedDetail = True
        End If
        ThisWorkbook.Worksheets("計算根拠").ExportAsFixedFormat _
            Type:=xlTypePDF, Filename:=temporary
    End If
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
    If areaChanged Then screen.PageSetup.PrintArea = previousArea
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
    RevealVerifiedResults
    CheckReportAvailable ThisWorkbook.Worksheets("操作画面")
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
