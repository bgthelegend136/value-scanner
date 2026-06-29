$ErrorActionPreference = 'Stop'
$TaskName = 'Bet-OddsIo-Sampler'
$Runner = Join-Path $PSScriptRoot 'run-oddsio-value-sampler.ps1'
$PowerShell = (Get-Command powershell.exe).Source
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$RepositoryRoot = Split-Path -Parent $HarnessRoot
$EnvCandidates = @((Join-Path $RepositoryRoot '.env.local'))

$GitCommon = git -C $HarnessRoot rev-parse --git-common-dir 2>$null
if ($LASTEXITCODE -eq 0 -and $GitCommon) {
  $GitCommonPath = if ([System.IO.Path]::IsPathRooted($GitCommon)) {
    $GitCommon
  } else {
    Join-Path $HarnessRoot $GitCommon
  }
  $MainRepositoryRoot = Split-Path -Parent (
    [System.IO.Path]::GetFullPath($GitCommonPath)
  )
  $EnvCandidates += Join-Path $MainRepositoryRoot '.env.local'
}

$EnvPath = $EnvCandidates |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1

if (-not $EnvPath) {
  throw "Missing required scheduler configuration: .env.local was not found."
}

$EnvText = Get-Content -Raw -LiteralPath $EnvPath
if ($EnvText -notmatch "(?m)^\s*ODDS_API_IO_KEY\s*=\s*\S+") {
  throw "Missing required scheduler configuration: ODDS_API_IO_KEY is empty or absent."
}

$Action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`""

# Measurement-only sampler: two /value-bets calls every two minutes for the
# selected free-tier books. This spends Odds-API.io requests but no The Odds API
# credits and sends no Telegram alerts.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 2) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$Principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description 'Measurement-only Odds-API.io value-bets sampler for Stoiximan/Pamestoixima. No Telegram.' `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName
