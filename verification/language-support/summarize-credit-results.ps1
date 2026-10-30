param(
    [Parameter(Mandatory = $true)][string]$TrxPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [string]$TestNameFilter = 'ReadingCreditCompatibilityTests',
    [string]$DatabaseLabel = 'SQLite in-memory; synthetic data only'
)

# Keep reproducible synthetic observations without machine paths or test-host logs.
[xml]$creditRun = Get-Content -LiteralPath $TrxPath -Raw
$observations = @($creditRun.TestRun.Results.UnitTestResult |
    Where-Object { $_.testName.Contains($TestNameFilter) } | Sort-Object testName | ForEach-Object {
    [ordered]@{
        test = $_.testName
        outcome = $_.outcome
        failure = $_.Output.ErrorInfo.Message
        observation = $_.Output.StdOut
    }
})
[ordered]@{
    runtime = 'net10.0'
    database = $DatabaseLabel
    results = $observations
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding utf8
