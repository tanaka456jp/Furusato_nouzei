function Test-SeparateTaxCases {
    param($Excel, $Book, [string]$FixturePath, [string]$PdfPath)
    $screen = $Book.Worksheets.Item('操作画面')
    $model = $Book.Worksheets.Item('分離課税詳細計算')
    $fixtures = @(Get-Content -LiteralPath $FixturePath -Raw -Encoding UTF8 | ConvertFrom-Json)
    $results = [System.Collections.Generic.List[object]]::new()
    try {
        $screen.Range('B44').Value2 = '申告分離'
        $screen.Range('D44').Value2 = '確定申告'
        $screen.Range('D49').Value2 = '照合済'
        foreach ($fixture in $fixtures) {
            $inputCase = $fixture.input
            $row = 45
            foreach ($kind in @('ordinary','shortLand','longLand','listedDividend','generalStock','listedStock','futures')) {
                $screen.Range("B$row").Value2 = [double]$inputCase.$kind
                $row++
            }
            $screen.Range('D45').Value2 = [double]$inputCase.nationalDeductions
            $screen.Range('D46').Value2 = [double]$inputCase.residentDeductions
            $screen.Range('D47').Value2 = [double]$inputCase.personalDifference
            $screen.Range('D48').Value2 = [double]$inputCase.donation
            $screen.Range('D50').Value2 = [double]$inputCase.year
            $Excel.Calculate()
            if ($Excel.CalculationState -ne 0) { throw "Split case not xlDone: $($fixture.id)" }
            if ([string]$model.Range('B2').Value2 -ne '計算可能') {
                throw "Split case blocked: $($fixture.id) $($model.Range('B2').Value2)"
            }
            $actual = [ordered]@{
                nationalApplied = @(16..22 | ForEach-Object { $model.Range("C$_").Value2 })
                residentApplied = @(16..22 | ForEach-Object { $model.Range("D$_").Value2 })
                nationalTaxable = @(16..22 | ForEach-Object { $model.Range("E$_").Value2 })
                residentTaxable = @(16..22 | ForEach-Object { $model.Range("G$_").Value2 })
                nationalUnused = $model.Range('B13').Value2
                residentUnused = $model.Range('B14').Value2
                nationalBefore = $model.Range('B7').Value2
                residentBefore = $model.Range('B10').Value2
                ratio = $model.Range('B6').Value2
                nationalAfter = $model.Range('K27').Value2
                residentAfter = $model.Range('O27').Value2 + $model.Range('P27').Value2
                netCost = $model.Range('S27').Value2
                limit = $screen.Range('B56').Value2
            }
            foreach ($key in $actual.Keys) {
                $got = ConvertTo-Json -Compress -InputObject $actual[$key]
                $expected = ConvertTo-Json -Compress -InputObject $fixture.expected.$key
                # Excel COM returns numbers as doubles. Compare numeric values
                # and array shape independently of JSON serializer formatting.
                $gotValues = @($actual[$key])
                $expectedValues = @($fixture.expected.$key)
                if ($gotValues.Count -ne $expectedValues.Count) { throw "Wrong shape: $($fixture.id) $key" }
                for ($i=0; $i -lt $gotValues.Count; $i++) {
                    if ($null -eq $gotValues[$i] -or [double]$gotValues[$i] -ne [double]$expectedValues[$i]) {
                        throw "Split mismatch $($fixture.id) $key observed=$got expected=$expected"
                    }
                }
            }
            if ([string]$screen.Range('B8').Value2 -ne '') { throw 'Normal amount visible in split mode' }
            $results.Add([ordered]@{id=$fixture.id; input=$inputCase; expected=$fixture.expected; observed=$actual; differences=0; verdict='PASS'; calculationState=0})
        }
        foreach ($case in @(@('D44','ワンストップ','SAFE-TAX-012'),@('D49','特例あり','SAFE-TAX-013'),@('D45',0,'SAFE-TAX-015'))) {
            $cell = $screen.Range($case[0])
            $previous = $cell.Value2
            if ($case[1] -is [int]) { $cell.Value2 = [double]$case[1] } else { $cell.Value2 = $case[1] }
            $Excel.Calculate()
            if ([string]$screen.Range('B55').Value2 -notlike ($case[2]+'*') -or [string]$screen.Range('B56').Value2 -ne '') {
                throw "Safety stop failed: $($case[2])"
            }
            $cell.Value2 = $previous
            $Excel.Calculate()
            if ([string]$screen.Range('B55').Value2 -ne '計算可能' -or $null -eq $screen.Range('B56').Value2) {
                throw "Recovery failed: $($case[2])"
            }
        }
        $area = [string]$screen.PageSetup.PrintArea
        if (-not $Excel.Run('TaxLawUpdater.ExportDetailsToFile', $PdfPath)) { throw 'Split PDF export failed' }
        $pdf = [System.IO.File]::ReadAllBytes($PdfPath)
        if ($pdf.Length -lt 500 -or [Text.Encoding]::ASCII.GetString($pdf, 0, 5) -ne '%PDF-') { throw 'Split PDF is invalid' }
        if ([string]$screen.PageSetup.PrintArea -ne $area) { throw 'Split PDF changed original print area' }
        $screen.Range('D49').Value2 = '特例あり'
        if ($Excel.Run('TaxLawUpdater.TryExportDetailsToFileForTest', (Join-Path (Split-Path $PdfPath) 'unsafe-split.pdf'))) { throw 'HOLD permitted a split PDF' }
        return $results.ToArray()
    }
    finally {
        $screen.Range('B44').Value2 = '給与・通常'
        $screen.Range('D44').Value2 = '確定申告'
        $screen.Range('D49').Value2 = '未確認'
        $screen.Range('D50').Value2 = 2026.0
        [void]$screen.Range('B45:B51,D45:D48').ClearContents()
        $Excel.Calculate()
    }
}
