Attribute VB_Name = "TaxLawUpdater"
Option Explicit

' Furusato_nouzei: audited year-by-year tax law updates (Excel 365 for Windows)
' Publisher: https://github.com/tanaka456jp/Furusato_nouzei
' The public catalog is data, NOT executable code. Never execute remote VBA.
Private Const CATALOG_URL As String = "https://raw.githubusercontent.com/tanaka456jp/Furusato_nouzei/main/taxdata/catalog.tsv"
Private Const TRUSTED_RELEASE_PREFIX As String = "https://github.com/tanaka456jp/Furusato_nouzei/releases/download/"
Private Const UPDATER_VERSION As String = "1.0.0"

Public Sub TaxLawUpdate()
    Dim bk As Workbook, front As Worksheet, year As Long
    Dim catalog As String, revision As String, packUrl As String, expectedHash As String
    Dim approved As String, oldYear As Variant, oldStatus As Variant
    Dim backupFile As String, downloadedFile As String, source As Workbook
    Dim names As Variant, restoreValues() As Variant, oldTest As Variant
    Dim i As Long, replaced As Boolean, hadTest As Boolean
    Dim errMessage As String
    Set bk = ThisWorkbook
    Set front = bk.Worksheets("操作画面")

    If Not IsNumeric(front.Range("B4").Value2) Then
        MsgBox "適用年は西暦4桁で指定してください。", vbExclamation, "税制更新"
        Exit Sub
    End If
    year = CLng(front.Range("B4").Value2)
    If year < 2025 Or year > 2099 Then
        MsgBox "適用年は2025～2099年の範囲で指定してください。", vbExclamation, "税制更新"
        Exit Sub
    End If

    On Error GoTo FAILED
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.StatusBar = "法改正マスタの承認状態を確認中…"
    catalog = DownloadText(CATALOG_URL)
    If Not ParseCatalog(catalog, year, approved, revision, packUrl, expectedHash) Then
        Err.Raise vbObjectError + 2001, , "選択年度は配信カタログにありません。未承認年度の更新は禁止します。"
    End If
    If UCase$(approved) <> "APPROVED" Then
        Err.Raise vbObjectError + 2002, , "指定年分は税法改正マスタが未承認です。計算年を変更しません。"
    End If
    oldYear = bk.Worksheets("設定・税率").Range("B4").Value2
    oldStatus = front.Range("B30").Value2

    If Len(packUrl) > 0 Then
        If Left$(packUrl, Len(TRUSTED_RELEASE_PREFIX)) <> TRUSTED_RELEASE_PREFIX Then
            Err.Raise vbObjectError + 2003, , "配信元が許可されたGitHub Releasesではありません。"
        End If
        If Not IsSha256(expectedHash) Then
            Err.Raise vbObjectError + 2004, , "SHA-256が不正です。更新を停止します。"
        End If
        downloadedFile = Environ$("TEMP") & "\furusato_taxdata_" & CStr(year) & ".xlsx"
        Application.StatusBar = "署名済み配布物のダウンロードとSHA-256確認中…"
        DownloadFile packUrl, downloadedFile
        If LCase$(FileSha256(downloadedFile)) <> LCase$(expectedHash) Then
            Err.Raise vbObjectError + 2005, , "SHA-256が一致しません。適用前に中止しました。"
        End If
        Set source = Application.Workbooks.Open(Filename:=downloadedFile, UpdateLinks:=0, ReadOnly:=True)
        If Not YearApprovedIn(source, year) Then
            Err.Raise vbObjectError + 2006, , "配布物の年度パラメータに承認済みの記載がありません。"
        End If
        ' Save a full, non-destructive backup before writing any master cells.
        backupFile = BackupName(bk)
        bk.SaveCopyAs backupFile
        names = MasterSheetNames()
        ReDim restoreValues(LBound(names) To UBound(names))
        For i = LBound(names) To UBound(names)
            restoreValues(i) = bk.Worksheets(CStr(names(i))).Range("A3:V900").Value2
        Next i
        oldTest = bk.Worksheets("自動回帰テスト").Range("A3:I400").Formula2
        hadTest = True
        replaced = True
        Application.StatusBar = "年度マスタと独立テストを取り込み中…"
        For i = LBound(names) To UBound(names)
            ReplaceMasterSheet source.Worksheets(CStr(names(i))), bk.Worksheets(CStr(names(i)))
        Next i
        ' New-year releases must publish separate regression test fixtures.
        If year >= 2027 Then
            If Not HasWorksheet(source, "自動回帰テスト") Then
                Err.Raise vbObjectError + 2007, , "新年度用回帰テストが添付されていません。"
            End If
            bk.Worksheets("自動回帰テスト").Range("A3:I400").ClearContents
            bk.Worksheets("自動回帰テスト").Range("A3:I400").Formula2 = source.Worksheets("自動回帰テスト").Range("A3:I400").Formula2
        End If
    ElseIf year <> 2025 And year <> 2026 Then
        Err.Raise vbObjectError + 2008, , "新しい年度には監査済みExcel更新パックが必須です。"
    End If

    bk.Worksheets("設定・税率").Range("B4").Value2 = year
    Application.CalculateFullRebuild
    If Not YearApprovedIn(bk, year) Then
        Err.Raise vbObjectError + 2009, , "更新後の年度パラメータは未承認です。"
    End If
    If Not ValidateMasterCounts(bk, year) Then
        Err.Raise vbObjectError + 2010, , "年度マスタの区分数が不足しています。"
    End If
    If CStr(bk.Worksheets("自動回帰テスト").Range("B49").Value2) <> "PASS" Then
        Err.Raise vbObjectError + 2011, , "回帰テストがPASSではありません。反映を取り消します。"
    End If
    If year >= 2027 Then
        If Not NewYearFixturesPassed(bk, year) Then
            Err.Raise vbObjectError + 2012, , "新年度の独立期待値テストが3件以上PASSしませんでした。"
        End If
    End If
    front.Range("B30").Value2 = "更新済：" & year & "年分 / " & revision & "｜金額は入力後に確認"
    On Error Resume Next
    bk.Save
    If Not source Is Nothing Then source.Close SaveChanges:=False
    If Len(downloadedFile) > 0 Then Kill downloadedFile
    Application.StatusBar = False
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    On Error GoTo 0
    MsgBox CStr(year) & "年分の承認済税制を適用しました。" & vbCrLf & _
           "住民税は翌年度課税です。入力金額と整合性チェックを確認してください。", vbInformation, "税制更新"
    Exit Sub

FAILED:
    errMessage = Err.Description
    On Error Resume Next
    If replaced Then
        For i = LBound(names) To UBound(names)
            bk.Worksheets(CStr(names(i))).Range("A3:V900").Value2 = restoreValues(i)
        Next i
        If hadTest Then bk.Worksheets("自動回帰テスト").Range("A3:I400").Formula2 = oldTest
    End If
    If Not IsEmpty(oldYear) Then bk.Worksheets("設定・税率").Range("B4").Value2 = oldYear
    front.Range("B30").Value2 = "更新中止：" & Left$(errMessage, 100)
    Application.CalculateFullRebuild
    If Not source Is Nothing Then source.Close SaveChanges:=False
    If Len(downloadedFile) > 0 Then Kill downloadedFile
    Application.StatusBar = False
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    On Error GoTo 0
    MsgBox "税制更新を中止しました。適用中の年度・既存データは維持しています。" & vbCrLf & errMessage, vbExclamation, "税制更新"
End Sub

Private Function DownloadText(ByVal url As String) As String
    Dim r As Object
    Set r = CreateObject("WinHttp.WinHttpRequest.5.1")
    r.SetTimeouts 5000, 5000, 12000, 25000
    r.Open "GET", url, False
    r.Send
    If r.Status <> 200 Then Err.Raise vbObjectError + 2020, , "承認済カタログが取得できません（HTTP " & r.Status & "）。"
    DownloadText = r.ResponseText
End Function

Private Function ParseCatalog(ByVal text As String, ByVal targetYear As Long, _
                ByRef approved As String, ByRef revision As String, _
                ByRef url As String, ByRef sha As String) As Boolean
    Dim lines As Variant, parts As Variant, line As Variant
    lines = Split(Replace(text, vbCr, vbNullString), vbLf)
    For Each line In lines
        If Len(Trim$(CStr(line))) > 0 And Left$(Trim$(CStr(line)), 1) <> "#" Then
            parts = Split(CStr(line), "|")
            If UBound(parts) >= 4 Then
                If IsNumeric(parts(0)) Then
                    If CLng(parts(0)) = targetYear Then
                        approved = Trim$(parts(1))
                        revision = Trim$(parts(2))
                        url = Trim$(parts(3))
                        sha = LCase$(Trim$(parts(4)))
                        ParseCatalog = True
                        Exit Function
                    End If
                End If
            End If
        End If
    Next line
End Function

Private Sub DownloadFile(ByVal url As String, ByVal savePath As String)
    Dim r As Object, stm As Object
    Set r = CreateObject("WinHttp.WinHttpRequest.5.1")
    r.SetTimeouts 5000, 5000, 15000, 90000
    r.Open "GET", url, False
    r.Send
    If r.Status <> 200 Then Err.Raise vbObjectError + 2021, , "更新パック取得失敗（HTTP " & r.Status & "）。"
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 1: stm.Open
    stm.Write r.ResponseBody
    stm.SaveToFile savePath, 2
    stm.Close
End Sub

Private Function IsSha256(ByVal s As String) As Boolean
    Dim i As Long, c As String
    If Len(s) <> 64 Then Exit Function
    For i = 1 To 64
        c = LCase$(Mid$(s, i, 1))
        If InStr(1, "0123456789abcdef", c, vbBinaryCompare) = 0 Then Exit Function
    Next i
    IsSha256 = True
End Function

Private Function FileSha256(ByVal filename As String) As String
    ' Reads SHA256 via the Windows built-in certutil; no downloaded code is executed.
    Dim sh As Object, cmd As String, output As String, lines As Variant, one As Variant, token As String
    Set sh = CreateObject("WScript.Shell")
    cmd = "cmd.exe /d /c certutil -hashfile """ & filename & """ SHA256"
    output = sh.Exec(cmd).StdOut.ReadAll
    lines = Split(Replace(output, vbCr, vbNullString), vbLf)
    For Each one In lines
        token = LCase$(Replace(Trim$(CStr(one)), " ", ""))
        If IsSha256(token) Then
            FileSha256 = token
            Exit Function
        End If
    Next one
    Err.Raise vbObjectError + 2022, , "更新パックのSHA-256を検証できません。"
End Function

Private Function MasterSheetNames() As Variant
    MasterSheetNames = Array("年度パラメータ", "年度別基礎控除", "年度別人的控除", _
       "年度別特定親族", "年度別配偶者控除", "年度別保険料計算", _
       "年度別控除上限", "年度別所得税率", "年度別給与控除")
End Function

Private Function HasWorksheet(ByVal b As Workbook, ByVal name As String) As Boolean
    Dim s As Worksheet
    On Error Resume Next
    Set s = b.Worksheets(name)
    HasWorksheet = Not s Is Nothing
    On Error GoTo 0
End Function

Private Sub ReplaceMasterSheet(ByVal src As Worksheet, ByVal dst As Worksheet)
    Dim lr As Long, lc As Long
    lr = src.Cells(src.Rows.Count, 1).End(xlUp).Row
    lc = src.Cells(3, src.Columns.Count).End(xlToLeft).Column
    If lr < 4 Or lr > 900 Or lc < 3 Or lc > 22 Then Err.Raise vbObjectError + 2023, , "配布マスタの行列範囲が不正：" & src.Name
    ' Master sheets must contain VALUES only; never execute imported formulas.
    If Application.WorksheetFunction.CountA(src.Range(src.Cells(4, 1), src.Cells(lr, lc))) = 0 Then Err.Raise vbObjectError + 2024, , "配布マスタが空です：" & src.Name
    If Application.WorksheetFunction.CountIf(src.Range(src.Cells(4, 1), src.Cells(lr, lc)), "=*") > 0 Then Err.Raise vbObjectError + 2025, , "配布マスタに数式が含まれます：" & src.Name
    dst.Range("A3:V900").ClearContents
    dst.Range(dst.Cells(3, 1), dst.Cells(lr, lc)).Value2 = src.Range(src.Cells(3, 1), src.Cells(lr, lc)).Value2
End Sub

Private Function YearApprovedIn(ByVal b As Workbook, ByVal year As Long) As Boolean
    Dim ws As Worksheet, i As Long, found As Long
    Set ws = b.Worksheets("年度パラメータ")
    For i = 4 To 50
        If ws.Cells(i, 1).Value2 = year Then
            found = found + 1
            If CStr(ws.Cells(i, 2).Value2) = "承認済" Then YearApprovedIn = True
        End If
    Next i
    If found <> 1 Then YearApprovedIn = False
End Function

Private Function ValidateMasterCounts(ByVal b As Workbook, ByVal year As Long) As Boolean
    Dim n As Variant, ws As Worksheet, expected As Variant, i As Long, rows As Long
    n = Array("年度別基礎控除", "年度別人的控除", "年度別特定親族", "年度別配偶者控除", _
              "年度別保険料計算", "年度別控除上限", "年度別所得税率", "年度別給与控除")
    expected = Array(9, 11, 11, 66, IIf(year = 2025, 16, 20), 1, 7, 5)
    For i = LBound(n) To UBound(n)
        Set ws = b.Worksheets(CStr(n(i)))
        rows = Application.WorksheetFunction.CountIf(ws.Range("A4:A900"), year)
        If year <= 2026 Then
            If rows <> CLng(expected(i)) Then Exit Function
        Else
            If rows < 1 Then Exit Function
        End If
    Next i
    ValidateMasterCounts = True
End Function

Private Function NewYearFixturesPassed(ByVal b As Workbook, ByVal year As Long) As Boolean
    Dim ws As Worksheet, i As Long, countRows As Long
    Set ws = b.Worksheets("自動回帰テスト")
    For i = 4 To 400
        If ws.Cells(i, 3).Value2 = year Then
            countRows = countRows + 1
            If ws.Cells(i, 8).Value2 <> "PASS" Then Exit Function
        End If
    Next i
    NewYearFixturesPassed = (countRows >= 3)
End Function

Private Function BackupName(ByVal b As Workbook) As String
    Dim dot As Long, base As String
    dot = InStrRev(b.FullName, ".")
    If dot = 0 Then Err.Raise vbObjectError + 2026, , "ブックは先に保存してください。"
    base = Left$(b.FullName, dot - 1)
    BackupName = base & "_更新前_" & Format$(Now, "yyyymmdd_hhnnss") & ".xlsm"
End Function