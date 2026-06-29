$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "betsson-poc-$Stamp.log"

# One-API experiment: Betsson h2h only, priced against other The Odds API books
# on the same event id. No Odds-API.io, no Telegram.
Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node src/cli.mjs theodds-betsson-poc --sports=soccer_fifa_world_cup --edge=1 --sample-min-ev=-2 --sample-limit=50
  if ($LASTEXITCODE -ne 0) {
    throw "betsson-poc exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
