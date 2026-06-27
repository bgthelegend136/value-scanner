$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$LogPath = Join-Path $LogDir "live-shadow-$Stamp.log"

# Measurement-only live shadow collection. It writes local CSVs only:
# reports/ws-lifetime-log.csv for closed confirmed-edge lifetimes and
# reports/ws-live-shadow-audit.csv for every strict EV candidate evaluation.
# reports/live-training-observations.csv for EV-banded live controls/values.
# reports/live-event-status.csv for score/status rows used by later joins.
Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node scripts/ws-lifetime-probe.mjs --live-shadow --live-training --live-training-min-ev=-5 --status=live --channels=odds,scores,status --markets=ML,Totals --duration-minutes=120
  if ($LASTEXITCODE -ne 0) {
    throw "live shadow probe exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
