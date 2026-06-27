$ErrorActionPreference = 'Stop'
$TaskName = 'Bet-Paper-CLV'
$Runner = Join-Path $PSScriptRoot 'run-paper-clv.ps1'
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

# Repeat every 10 minutes because the CLI captures only rows whose kickoff is
# inside the paper CLV window. No due rows means no The Odds API request.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 10) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

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
  -Description 'Paper-only: captures CLV near kickoff for recorded paper value bets. No Telegram.' `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName
