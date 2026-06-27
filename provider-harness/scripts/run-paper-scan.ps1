$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "paper-scan-$Stamp.log"

# Paper-only data collection: record all positive EV rows plus a capped control
# sample down to -5% EV. Repeated hourly snapshots are distinct paper observations
# so CLV-vs-EV analysis can reach useful volume quickly. This does not affect the
# strict Telegram alert floor.
Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node src/cli.mjs scan --edge=0 --sample-min-ev=-5 --sample-limit=250 --sample-repeat
  if ($LASTEXITCODE -ne 0) {
    throw "scan exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
