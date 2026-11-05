Attribute VB_Name = "TaxLawUpdater"
Option Explicit

Private Const CATALOG_URL As String = "https://raw.githubusercontent.com/tanaka456jp/Furusato_nouzei/main/taxdata/catalog.tsv"
Private Const BUNDLED_REVISION As String = "2026-11-05-bundled"

' User-facing command. The test entrypoint executes the very same transaction,
' but reports failures as exceptions instead of modal dialogs.
Public Sub TaxLawUpdate()
    Call ApplyApprovedYear(False)
End Sub

Public Function TaxLawUpdateForTest() As Boolean
    TaxLawUpdateForTest = ApplyApprovedYear(True)
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
        Err.Raise vbObjectError + 116, "TaxLawUpdater.TaxLawUpdateForTest", problem
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

Public Sub RecalculateCase()
    Application.Calculate
End Sub

Public Sub NewCase()
    If MsgBox("現在の入力を消去しますか？保存が必要な場合は先に案件保存してください。", _
              vbQuestion + vbYesNo + vbDefaultButton2, "新規入力") <> vbYes Then Exit Sub
    ThisWorkbook.Worksheets("操作画面").Range("B11:B26,D11:D25").ClearContents
    Application.Calculate
End Sub

' Save-copy core is shared between the UI and an isolated Windows acceptance test.
' Never overwrite an existing customer case, including a previous test run.
Public Function SaveCaseToFile(ByVal destination As String) As Boolean
    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    If Len(Trim$(destination)) = 0 Or LCase$(Right$(destination, 5)) <> ".xlsm" Then
        Err.Raise vbObjectError + 108, , ".xlsmの拡張子で保存してください。"
    End If
    If fso.FileExists(destination) Then
        Err.Raise vbObjectError + 109, , "同名ファイルがあります。別の名前で保存してください。"
    End If
    Application.Calculate
    ThisWorkbook.SaveCopyAs destination
    If Not fso.FileExists(destination) Then
        Err.Raise vbObjectError + 117, , "案件ファイルの保存を確認できません。"
    End If
    If fso.GetFile(destination).Size = 0 Then
        Err.Raise vbObjectError + 118, , "保存された案件ファイルが空です。"
    End If
    SaveCaseToFile = True
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
    If LCase$(Right$(CStr(destination), 4)) <> ".pdf" Then
        Err.Raise vbObjectError + 112, , ".pdfの拡張子で保存してください。"
    End If
    If CreateObject("Scripting.FileSystemObject").FileExists(CStr(destination)) Then
        Err.Raise vbObjectError + 113, , "同名のPDFがあります。別の名前を指定してください。"
    End If
    ShowDetails
    ThisWorkbook.Worksheets("計算根拠").ExportAsFixedFormat Type:=xlTypePDF, Filename:=CStr(destination)
    Exit Sub
Failed:
    MsgBox Err.Description, vbExclamation, "PDF出力"
End Sub
