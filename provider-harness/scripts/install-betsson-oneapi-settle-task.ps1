$ErrorActionPreference = 'Stop'
$TaskName = 'Bet-Betsson-OneApi-Settle'
$Runner = Join-Path $PSScriptRoot 'run-betsson-oneapi-settle.ps1'
$PowerShell = (Get-Command powershell.exe).Source
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$RepositoryRoot = Split-Path -Parent $HarnessRoot
$EnvCandidates = @((Join-Path $RepositoryRoot '.env.local'))

$GitCommon = git -C $HarnessRoot rev-parse --git-common-dir 2>$null
if ($LASTEXITCODE -eq 0 -and $GitCommon) {
  $GitCommonPath = if ([System.IO.Path]::IsPathRooted($GitCommon)) { $GitCommon } else { Join-Path $HarnessRoot $GitCommon }
  $MainRepositoryRoot = Split-Path -Parent ([System.IO.Path]::GetFullPath($GitCommonPath))
  $EnvCandidates += Join-Path $MainRepositoryRoot '.env.local'
}

$EnvPath = $EnvCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $EnvPath) {
  throw "Missing required scheduler configuration: .env.local was not found."
}

$EnvText = Get-Content -Raw -LiteralPath $EnvPath
if ($EnvText -notmatch "(?m)^\s*THE_ODDS_API_KEY\s*=\s*\S+") {
  throw "Missing required scheduler configuration: THE_ODDS_API_KEY is empty or absent."
}

$Action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`""

$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Hours 6) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

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
  -Description 'Betsson one-api settlement for the dedicated ledger.' `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName
