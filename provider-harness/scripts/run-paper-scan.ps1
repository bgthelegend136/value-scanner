$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "paper-scan-$Stamp.log"

# Paper-only data collection: record +EV value bets across every in-season
# league, then capture closing-line value for pending bets. Sends nothing to
# Telegram and never touches the 10% live-alert floor.
Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node src/cli.mjs scan
  if ($LASTEXITCODE -ne 0) {
    throw "scan exited with code $LASTEXITCODE"
  }
  node src/cli.mjs clv
  if ($LASTEXITCODE -ne 0) {
    throw "clv exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
