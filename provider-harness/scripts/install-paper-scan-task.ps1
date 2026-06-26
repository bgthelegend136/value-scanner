$ErrorActionPreference = 'Stop'
$TaskName = 'Bet-Paper-Scan'
$Runner = Join-Path $PSScriptRoot 'run-paper-scan.ps1'
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

# The paper path needs only the two odds providers -- no Telegram, by design.
$EnvText = Get-Content -Raw -LiteralPath $EnvPath
$RequiredKeys = @(
  'ODDS_API_IO_KEY'
  'THE_ODDS_API_KEY'
)
foreach ($Key in $RequiredKeys) {
  if ($EnvText -notmatch "(?m)^\s*$Key\s*=\s*\S+") {
    throw "Missing required scheduler configuration: $Key is empty or absent."
  }
}

$Action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`""

# Repeat every 8 hours (3 runs/day) so a 3-day experiment costs ~3 x 20 credits
# per day and stays well inside the 500/month The Odds API free tier. The
# 3650-day duration avoids the [TimeSpan]::MaxValue bug in
# New-ScheduledTaskTrigger. -StartWhenAvailable backfills runs missed while the
# machine was asleep. REVIEW/disable this task after the data-collection window.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Hours 8) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

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
  -Description 'Paper-only: records +EV value bets across in-season leagues and captures CLV. No Telegram.' `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName
