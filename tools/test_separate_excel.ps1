function Test-SeparateTaxCases {
    param($Excel, $Book, [string]$FixturePath, [string]$PdfPath)
    $screen = $Book.Worksheets.Item('操作画面')
    $model = $Book.Worksheets.Item('分離課税詳細計算')
    $fixtures = Get-Content -LiteralPath $FixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($fixtures.Count -ne 42) { throw 'Expected 42 independent split fixtures' }
    $exactPath = Join-Path (Split-Path $FixturePath) 'separate-tax-exact-v1.json'
    $edges = Get-Content -LiteralPath $exactPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($edges.Count -ne $fixtures.Count) { throw 'Expected an exact limit fixture per split case' }
    $localPath = Join-Path (Split-Path $FixturePath) 'separate-tax-local-v1.json'
    $localFixtures = Get-Content -LiteralPath $localPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($localFixtures.Count -ne 7) { throw 'Expected seven new municipality and rounding fixtures' }
    $creditPath = Join-Path (Split-Path $FixturePath) 'separate-tax-credits-v1.json'
    $creditFixtures = Get-Content -LiteralPath $creditPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($creditFixtures.Count -ne 21) { throw 'Expected 21 independently verified tax credit fixtures' }
    $results = [System.Collections.Generic.List[object]]::new()
    try {
        $screen.Range('B44').Value2 = '申告分離'
        $screen.Range('D44').Value2 = '確定申告'
        $screen.Range('D49').Value2 = '照合済'
        foreach ($fixture in ($fixtures + $localFixtures + $creditFixtures)) {
            $inputCase = $fixture.input
            $screen.Range('D51').Value2 = [string]$(if ($inputCase.municipality -eq 'designated') { '標準指定都市' } else { '標準市町村' })
            $row = 45
            foreach ($kind in @('ordinary','shortLand','longLand','listedDividend','generalStock','listedStock','futures')) {
                $screen.Range("B$row").Value2 = [double]$inputCase.$kind
                $row++
            }
            $creditRow = 72
            foreach ($credit in @('housingYear','housingBalance','housingPossible','domesticDividend','foreignTax','foreignIncome')) {
                $screen.Range("D$creditRow").Value2 = [double]$inputCase.PSObject.Properties[$credit].Value
                $creditRow++
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
            if ($fixture.exact) {
                $actual.residentBeforeParts = @('E10','E11' | ForEach-Object { $model.Range($_).Value2 })
                $actual.residentAfterParts = @('O27','P27' | ForEach-Object { $model.Range($_).Value2 })
            }
            if ($fixture.expected.creditBefore) {
                foreach ($pair in @(@('creditBefore','E'),@('creditAfter','F'))) {
                    $actual[$pair[0]] = @(9,6,4,5,8,2,3 | ForEach-Object { $model.Range(($pair[1] + $_)).Value2 })
                }
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
            $edge = if ($fixture.exact) { $fixture.exact } else { $edges | Where-Object id -eq $fixture.id }
            $exact = [ordered]@{
                maximum = $screen.Range('B69').Value2
                rounded = $screen.Range('D69').Value2
                costAtMaximum = $model.Range('S23').Value2
                costNext = $model.Range('S24').Value2
            }
            foreach ($key in $exact.Keys) {
                if ($null -eq $exact[$key] -or [double]$exact[$key] -ne [double]$edge.$key) {
                    throw "Exact split mismatch $($fixture.id) $key observed=$($exact[$key]) expected=$($edge.$key)"
                }
            }
            $results.Add([ordered]@{id=$fixture.id; input=$inputCase; expected=$fixture.expected; observed=$actual; exact_expected=$edge; exact_observed=$exact; differences=0; verdict='PASS'; calculationState=0})
        }
        foreach ($case in @(@('D44','ワンストップ','SAFE-TAX-012'),@('D49','特例あり','SAFE-TAX-013'),@('D45',0,'SAFE-TAX-015'),@('D51','条例差・不明','SAFE-TAX-019'),@('D72',2027,'SAFE-TAX-020'),@('D75',10000000,'SAFE-TAX-023'),@('D77',100000,'SAFE-TAX-023'))) {
            $cell = $screen.Range($case[0])
            $previous = $cell.Value2
            if ($case[1] -is [int]) {
                $cell.Value2 = [double]$case[1]
            } else {
                $cell.Value2 = [string]$case[1]
            }
            $Excel.Calculate()
            if ([string]$screen.Range('B55').Value2 -notlike ($case[2]+'*') -or [string]$screen.Range('B56').Value2 -ne '' -or [string]$screen.Range('B69').Value2 -ne '') {
                throw "Safety stop failed: $($case[2])"
            }
            if ($previous -is [double]) {
                $cell.Value2 = [double]$previous
            } else {
                $cell.Value2 = [string]$previous
            }
            $Excel.Calculate()
            if ([string]$screen.Range('B55').Value2 -ne '計算可能' -or $null -eq $screen.Range('B56').Value2) {
                throw "Recovery failed: $($case[2])"
            }
        }
        # Second print page starts at row 80. Verify its computed revision
        # and tax year in actual Excel before exporting the synthetic PDF.
        $pageTwo = [string]$screen.Range('A80').Value2
        $selectedYear = [string][int]([double]$screen.Range('D50').Value2)
        # Compare the page-2 revision to the version actually displayed by
        # this SAME built workbook; never pin a superseded development version.
        $banner = [string]$screen.Range('A1').Value2
        $reviewVersion = [regex]::Match($banner, 'v\d+\.\d+\.\d+').Value
        if (-not $reviewVersion) { throw 'Version not found in review workbook banner' }
        if ($pageTwo -notlike '*所得年*' -or
            $pageTwo -notlike ('*' + $selectedYear + '*') -or
            $pageTwo -notlike ('*' + $reviewVersion + '*') -or
            $pageTwo -notlike '*税制版*') {
            throw ('Second-page year/version header not calculated: ' + $pageTwo)
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
        $screen.Range('D51').Value2 = '標準市町村'
        [void]$screen.Range('B45:B51,D45:D48').ClearContents()
        $screen.Range('D72:D77').Value2 = 0.0
        $Excel.Calculate()
    }
}
