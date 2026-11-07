Attribute VB_Name = "TaxLawUpdater"
Option Explicit

' Only isolated tests use this nonmodal diagnostic state.
Private mLastTestFailure As String

Private Const CATALOG_URL As String = "https://raw.githubusercontent.com/tanaka456jp/Furusato_nouzei/main/taxdata/catalog.tsv"
Private Const BUNDLED_REVISION As String = "2026-11-05-bundled"

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
    BindButton "操作画面", "btnReviewWithholding", "ReviewWithholding"
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
    Dim status As String, raw As String, backup As String, caution As String
    Dim home As Worksheet, extra As Worksheet, code As Long, problem As String
    On Error GoTo Failed
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
    If status <> "READY_FOR_EXCEL_CROSSCHECK" And status <> "REQUIRES_REVIEW" Then
        Err.Raise vbObjectError + 207, , "読取状態が不正です。"
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
        If key <> "STATUS" And key <> "YEAR" And key <> "WARNINGS" Then
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
                     "special_relative_deduction_reference"
                    ' Allowed amounts only; all other columns are rejected.
                Case Else
                    Err.Raise vbObjectError + 213, , "未承認の取込項目を検出しました。"
            End Select
        End If
    Next key
    caution = "源泉徴収票の読み取れた数値を転記し、現在の入力を置換しますか？" & vbCrLf & _
              "既存データはバックアップします。"
    If status = "REQUIRES_REVIEW" Then
        caution = caution & vbCrLf & vbCrLf & _
              "このPDFは一部項目が未確定です。読み取れた数値だけを仮転記します。" & vbCrLf & _
              "原票照合を完了するまで寄附限度額の確定表示は停止します。"
    End If
    If MsgBox(caution, vbQuestion + vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    backup = UniqueBackupPath(ThisWorkbook)
    ThisWorkbook.SaveCopyAs backup
    If Not fso.FileExists(backup) Then Err.Raise vbObjectError + 214, , "更新前のバックアップを作成できません。"
    Set home = ThisWorkbook.Worksheets("操作画面")
    Set extra = ThisWorkbook.Worksheets("例外・分離課税")
    ResetSeparateInputs home
    home.Range("B11:B12,B15:B16,B19:B25,B33:B36,D11:D23").ClearContents
    ' Leave independent pension, business and other income entries untouched.
    extra.Range("B13:B20").ClearContents
    extra.Range("B38:B39").ClearContents
    extra.Range("B32").ClearContents
    ' B4 and home B26 are calculated indicators: never overwrite formulas.
    home.Range("B25").Value2 = "なし"
    home.Range("D22").Value2 = "該当なし"
    home.Range("D24").Value2 = "ワンストップ"
    home.Range("B4").Value2 = year
    home.Range("B11").Value2 = year
    For Each key In fields.Keys
        If key <> "STATUS" And key <> "YEAR" And key <> "WARNINGS" Then
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
                Case "under16_count":
                    home.Range("D23").Value2 = value
                    If value > 0 Then home.Range("B25").Value2 = "あり"
                Case "income_adjustment": extra.Range("B13").Value2 = value
                Case "special_relative_count": extra.Range("B38").Value2 = value
                Case "special_relative_deduction_reference": extra.Range("B39").Value2 = value
            End Select
        End If
    Next key
    ' Housing credit is a routine on-sheet input, not an advanced-case switch.
    ' The sheet formula still blocks missing applied amounts or unsupported years.
    extra.Range("B19").Value2 = "ローカル・項目コード照合"
    extra.Range("B20").Value2 = status
    If fields.Exists("WARNINGS") Then extra.Range("B32").Value2 = fields("WARNINGS")
    Application.Calculate
    If status = "REQUIRES_REVIEW" Then
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

Public Sub ReviewWithholding()
    Dim home As Worksheet, extra As Worksheet, msg As String
    Dim value As Double, refCell As Variant, calcCell As Variant
    Dim familyCell As Variant, specialTotal As Double, specialCount As Long
    Dim familyIncome As Double, specialDeduction As Double
    On Error GoTo Failed
    Set home = ThisWorkbook.Worksheets("操作画面")
    Set extra = ThisWorkbook.Worksheets("例外・分離課税")
    If CStr(extra.Range("B20").Value2) <> "REQUIRES_REVIEW" Then
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
    ' Keep G72/G74 provisional until the actual relatives' incomes
    ' reconcile both the count and the official deduction table.
    If Val(CStr(extra.Range("B39").Value2)) > 0 And _
       Val(CStr(extra.Range("B38").Value2)) = 0 Then
        Err.Raise vbObjectError + 244, , "特定親族の人数が原票から読み取れていません。"
    End If
    If Val(CStr(extra.Range("B38").Value2)) > 0 Then
        If Not IsNumeric(extra.Range("B39").Value2) Then
            Err.Raise vbObjectError + 245, , "特定親族特別控除額（G74）を確認してください。"
        End If
        For Each familyCell In Array("D14", "D15", "D16")
            If IsNumeric(home.Range(CStr(familyCell)).Value2) Then
                familyIncome = CDbl(home.Range(CStr(familyCell)).Value2)
                specialDeduction = SpecialRelativeTaxDeduction( _
                    familyIncome, CLng(home.Range("B11").Value2))
                If specialDeduction > 0 Then
                    specialCount = specialCount + 1
                    specialTotal = specialTotal + specialDeduction
                End If
            End If
        Next familyCell
        If specialCount <> CLng(extra.Range("B38").Value2) Then
            Err.Raise vbObjectError + 246, , "特定親族の合計所得を人数分入力し、原票と照合してください。"
        End If
        If Abs(specialTotal - CDbl(extra.Range("B39").Value2)) > 1 Then
            Err.Raise vbObjectError + 247, , "特定親族特別控除額（G74）と所得内訳の計算が一致しません。"
        End If
    End If
    Application.Calculate
    For Each refCell In Array("B14", "B15", "B16", "B17")
        Select Case CStr(refCell)
            Case "B14": Set calcCell = home.Range("B14")
            Case "B15": Set calcCell = home.Range("B13")
            Case "B16": Set calcCell = home.Range("B17")
            Case "B17": Set calcCell = home.Range("B18")
        End Select
        If IsNumeric(extra.Range(CStr(refCell)).Value2) Then
            If Not IsNumeric(calcCell.Value2) Then
                Err.Raise vbObjectError + 242, , "自動控除額を算定できません。"
            End If
            If Abs(CDbl(extra.Range(CStr(refCell)).Value2) - CDbl(calcCell.Value2)) > 1 Then
                Err.Raise vbObjectError + 243, , "源泉徴収票の金額と自動計算に差があります。控除内訳を見直してください。"
            End If
        End If
        Set calcCell = Nothing
    Next refCell
    If MsgBox("源泉徴収票の未確認項目を確認しましたか？" & vbCrLf & _
              "読取結果を照合済みにします。", vbQuestion + vbYesNo + vbDefaultButton2) <> vbYes Then Exit Sub
    extra.Range("B20").Value2 = "VERIFIED_AFTER_CORRECTION"
    Application.Calculate
    MsgBox "原票照合状態を更新しました。未対応案件は引き続き限度額を表示しません。", vbInformation
    Exit Sub
Failed:
    msg = Err.Description
    MsgBox msg, vbExclamation, "読取内容の確認"
End Sub

Public Sub RecalculateCase()
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
End Sub

Private Sub ResetSeparateInputs(ByVal home As Worksheet)
    ' Only templates with this detail section own these ranges.
    If CStr(home.Range("A42").Value2) <> "詳細設定 | 申告分離課税（検証版）" Then Exit Sub
    home.Range("B44").Value2 = "給与・通常"
    home.Range("B45:B51,D45:D48").ClearContents
    home.Range("D44").Value2 = "確定申告"
    home.Range("D49").Value2 = "未確認"
    home.Range("D50").Value2 = 2026
    home.Range("D51").Value2 = "標準市町村"
    If CStr(home.Range("A71").Value2) = "詳細設定 | 税額控除（該当なしは0）" Then home.Range("D72:D77").Value2 = 0
End Sub

Public Sub NewCase()
    If MsgBox("現在の入力を消去しますか？保存が必要な場合は先に案件保存してください。", _
              vbQuestion + vbYesNo + vbDefaultButton2, "新規入力") <> vbYes Then Exit Sub
    ResetSeparateInputs ThisWorkbook.Worksheets("操作画面")
    With ThisWorkbook.Worksheets("操作画面")
        .Range("B11:B12,B15:B16,B19:B25,B33:B36,D11:D23").ClearContents
        .Range("B11").Value2 = .Range("B4").Value2
        .Range("B25").Value2 = "なし"
        .Range("D22").Value2 = "該当なし"
        .Range("D24").Value2 = "ワンストップ"
    End With
    With ThisWorkbook.Worksheets("例外・分離課税")
        ' Preserve calculated cells B7/B22/B28-B30.
        .Range("B5:B6,B8:B12,B13:B21,B24:B26,B32,B36,B38:B39").ClearContents
        .Range("B25").Value2 = "なし"
        .Range("B33").Value2 = "なし"
        ' B4 is calculated from B24, and must survive NewCase.
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
    Call RecalculateCase
    ThisWorkbook.Worksheets("操作画面").Activate
    ThisWorkbook.Worksheets("例外・分離課税").Visible = xlSheetVeryHidden
End Sub

Public Sub ShowDetails()
    Dim screen As Worksheet
    Set screen = ThisWorkbook.Worksheets("操作画面")
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
    SeparateMode = (CStr(screen.Range("A42").Value2) = "詳細設定 | 申告分離課税（検証版）" And _
                    CStr(screen.Range("B44").Value2) = "申告分離")
End Function

Private Sub CheckReportAvailable(ByVal screen As Worksheet)
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
        DetailsPrintArea = DetailsPrintArea & ",$A$80:$D$86"
    End If
End Function

Public Sub PrintDetails()
    Dim screen As Worksheet, previousArea As String, areaChanged As Boolean
    Dim problem As String
    On Error GoTo Failed
    Application.Calculate
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
