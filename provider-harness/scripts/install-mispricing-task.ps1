$ErrorActionPreference = 'Stop'
$TaskName = 'Bet-Mispricing-Scanner'
$Runner = Join-Path $PSScriptRoot 'run-mispricing-scan.ps1'
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
$RequiredKeys = @(
  'ODDS_API_IO_KEY'
  'THE_ODDS_API_KEY'
  'TELEGRAM_BOT_TOKEN'
  'TELEGRAM_CHAT_ID'
)
foreach ($Key in $RequiredKeys) {
  if ($EnvText -notmatch "(?m)^\s*$Key\s*=\s*\S+") {
    throw "Missing required scheduler configuration: $Key is empty or absent."
  }
}

$Action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`""

# Repeat every 15 minutes, indefinitely (3650-day duration avoids the
# [TimeSpan]::MaxValue bug in New-ScheduledTaskTrigger). The detection tier is
# cheap -- a no-op cycle spends zero Pinnacle credits; only a fresh >=5%
# candidate escalates to confirmation. Alerts label >=10% separately as urgent.
# -StartWhenAvailable backfills runs missed
# while the machine was asleep.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 15) `
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
  -Description 'Sends independently confirmed Stoiximan/Novibet mispricing alerts to Telegram.' `
  -Force | Out-Null

# The older funnel sampler duplicates provider calls. Keep its history, but
# disable future runs after the production scanner is registered.
if (Get-ScheduledTask -TaskName 'Bet-Mispricing-Funnel' -ErrorAction SilentlyContinue) {
  Disable-ScheduledTask -TaskName 'Bet-Mispricing-Funnel' | Out-Null
}

Get-ScheduledTask -TaskName $TaskName
