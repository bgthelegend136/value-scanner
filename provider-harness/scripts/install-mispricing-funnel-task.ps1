# Registers a Windows Task Scheduler task that samples the mispricing funnel four
# times a day and appends a metrics row to reports/mispricing-funnel-log.csv.
# Read-only measurement: it sends nothing and places no bets. Re-run to update.
# Edit the -At times below to sample more or less often.
$ErrorActionPreference = 'Stop'
$TaskName = 'Bet-Mispricing-Funnel'
$Runner = Join-Path $PSScriptRoot 'run-mispricing-funnel.ps1'
$PowerShell = (Get-Command powershell.exe).Source

$Action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`""

$Triggers = @(
  New-ScheduledTaskTrigger -Daily -At '09:00'
  New-ScheduledTaskTrigger -Daily -At '13:00'
  New-ScheduledTaskTrigger -Daily -At '17:00'
  New-ScheduledTaskTrigger -Daily -At '21:00'
)

$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable $true `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

$Principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Triggers `
  -Settings $Settings `
  -Principal $Principal `
  -Description 'Samples the Stoiximan mispricing funnel (read-only) and logs EV distribution for go/no-go analysis.' `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName
