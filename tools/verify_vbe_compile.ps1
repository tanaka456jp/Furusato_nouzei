#Requires -Version 5.1
param(
    [Parameter(Mandatory=$true)][string]$Workbook,
    [Parameter(Mandatory=$true)][string]$EvidencePath
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Workbook).Path
if (Test-Path -LiteralPath $EvidencePath) { throw 'VBE_COMPILE_EVIDENCE_ALREADY_EXISTS' }
$hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$excel = $null
$book = $null
$project = $null
$pane = $null
$command = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.AutomationSecurity = 3
    if ($excel.Workbooks.Count -ne 0) { throw 'VBE_COMPILE_EXCEL_NOT_ISOLATED' }
    $book = $excel.Workbooks.Open($source, 0, $true)
    $project = $book.VBProject
    $module = $project.VBComponents.Item('TaxLawUpdater').CodeModule
    $pane = $module.CodePane
    $excel.VBE.ActiveVBProject = $project
    $pane.Show()
    $activeModule = $excel.VBE.ActiveCodePane.CodeModule
    if ($activeModule.Parent.Name -cne 'TaxLawUpdater' -or
        $excel.VBE.ActiveVBProject.FileName -ine $source) {
        throw 'VBE_COMPILE_WRONG_ACTIVE_PROJECT'
    }
    # VBE's built-in Debug > Compile VBAProject command (locale-independent).
    $command = $excel.VBE.CommandBars.FindControl(1, 578)
    if ($null -eq $command) { throw 'VBE_COMPILE_COMMAND_UNAVAILABLE' }
    $state = 'VBE_ALREADY_COMPILED'
    if ($command.Enabled) {
        $command.Execute()
        $state = 'VBE_COMPILE_EXECUTED'
    }
    if ($command.Enabled) {
        # Report only source module and line coordinates (never source text,
        # workbook values or customer identifiers). This makes a genuine VBE
        # compile failure actionable from the isolated PC1 runner.
        $moduleName = 'UNKNOWN'
        $lineNo = 0; $colNo = 0; $endLine = 0; $endCol = 0
        try {
            $active = $excel.VBE.ActiveCodePane
            if ($null -ne $active) {
                $moduleName = [string]$active.CodeModule.Parent.Name
                $active.GetSelection([ref]$lineNo,[ref]$colNo,
                                     [ref]$endLine,[ref]$endCol)
            }
        } catch {
            $moduleName = 'SELECTION_UNAVAILABLE'
        }
        if ($moduleName -notmatch '^[A-Za-z0-9_]{1,64}
} finally {
    if ($book) { $book.Close($false) }
    if ($excel) { $excel.Quit() }
    foreach ($object in @($command, $pane, $project, $book, $excel)) {
        if ($null -ne $object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
    }
}
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hash) {
    throw 'VBE_COMPILE_CHANGED_WORKBOOK'
}
$report = [ordered]@{
    schema = 'furusato-vbe-compile/v1'
    workbook_sha256 = $hash
    status = $state
    command_id = 578
    command_enabled_after = $false
}
[IO.File]::WriteAllText($EvidencePath, ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Host ('VBE_COMPILE_RESULT=' + $state)
) {
            $moduleName = 'UNKNOWN'
        }
        Write-Host ('VBE_COMPILE_INCOMPLETE_SOURCE_MODULE=' + $moduleName)
        Write-Host ('VBE_COMPILE_INCOMPLETE_SOURCE_LINE=' + [int]$lineNo)
        throw 'VBE_COMPILE_INCOMPLETE'
    }
} finally {
    if ($book) { $book.Close($false) }
    if ($excel) { $excel.Quit() }
    foreach ($object in @($command, $pane, $project, $book, $excel)) {
        if ($null -ne $object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($object) }
    }
}
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hash) {
    throw 'VBE_COMPILE_CHANGED_WORKBOOK'
}
$report = [ordered]@{
    schema = 'furusato-vbe-compile/v1'
    workbook_sha256 = $hash
    status = $state
    command_id = 578
    command_enabled_after = $false
}
[IO.File]::WriteAllText($EvidencePath, ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Host ('VBE_COMPILE_RESULT=' + $state)
