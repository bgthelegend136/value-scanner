$ErrorActionPreference = 'Stop'

$HarnessRoot = Split-Path -Parent $PSScriptRoot
$RepositoryRoot = Split-Path -Parent $HarnessRoot
$HiddenRunner = Join-Path $PSScriptRoot 'run-hidden.vbs'
$WScript = Join-Path $env:WINDIR 'System32\wscript.exe'
$BetssonRoot = Join-Path $RepositoryRoot '.worktrees\betsson-single-api-poc\provider-harness'

if (-not (Test-Path -LiteralPath $HiddenRunner)) {
  throw "Missing hidden task runner: $HiddenRunner"
}

$TaskRunners = @{
  'Bet-Paper-Scan' = Join-Path $HarnessRoot 'scripts\run-paper-scan.ps1'
  'Bet-Paper-CLV' = Join-Path $HarnessRoot 'scripts\run-paper-clv.ps1'
  'Bet-Paper-Settle' = Join-Path $HarnessRoot 'scripts\run-paper-settle.ps1'
  'Bet-Mispricing-Scanner' = Join-Path $HarnessRoot 'scripts\run-mispricing-scan.ps1'
  'Bet-Mispricing-CLV' = Join-Path $HarnessRoot 'scripts\run-mispricing-clv.ps1'
  'Bet-Live-Updated-Poll' = Join-Path $HarnessRoot 'scripts\run-live-updated-poll.ps1'
  'Bet-OddsIo-Sampler' = Join-Path $HarnessRoot 'scripts\run-oddsio-value-sampler.ps1'
  'Bet-Betsson-OneApi-Scan' = Join-Path $BetssonRoot 'scripts\run-betsson-oneapi-scan.ps1'
  'Bet-Betsson-OneApi-CLV' = Join-Path $BetssonRoot 'scripts\run-betsson-oneapi-clv.ps1'
  'Bet-Betsson-OneApi-Settle' = Join-Path $BetssonRoot 'scripts\run-betsson-oneapi-settle.ps1'
}

foreach ($Name in ($TaskRunners.Keys | Sort-Object)) {
  $Task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $Task) {
    Write-Warning "Scheduled task not found: $Name"
    continue
  }

  $Runner = $TaskRunners[$Name]
  if (-not (Test-Path -LiteralPath $Runner)) {
    Write-Warning "Runner not found for $Name`: $Runner"
    continue
  }

  $Action = New-ScheduledTaskAction `
    -Execute $WScript `
    -Argument "`"$HiddenRunner`" `"$Runner`""

  Set-ScheduledTask -TaskName $Name -Action $Action | Out-Null
  Enable-ScheduledTask -TaskName $Name | Out-Null
}

Disable-ScheduledTask -TaskName 'Bet-Betsson-Poc' -ErrorAction SilentlyContinue | Out-Null
Disable-ScheduledTask -TaskName 'Bet-Mispricing-Funnel' -ErrorAction SilentlyContinue | Out-Null
Disable-ScheduledTask -TaskName 'Bet-Live-Shadow' -ErrorAction SilentlyContinue | Out-Null

Get-ScheduledTask |
  Where-Object { $_.TaskName -like 'Bet-*' } |
  Select-Object TaskName, State |
  Sort-Object TaskName |
  Format-Table -AutoSize
