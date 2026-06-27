$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "paper-scan-$Stamp.log"

# Paper-only data collection: lower the paper threshold to 0.5% so the ledger
# contains enough low/mid EV rows to measure CLV-vs-EV slope later. This does
# not affect the strict Telegram alert floor.
Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node src/cli.mjs scan --edge=0.5
  if ($LASTEXITCODE -ne 0) {
    throw "scan exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
