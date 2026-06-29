$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "betsson-oneapi-scan-$Stamp.log"

Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node src/cli.mjs theodds-betsson-poc --sports=soccer_fifa_world_cup,soccer_brazil_campeonato,soccer_brazil_serie_b,soccer_sweden_allsvenskan,soccer_norway_eliteserien,soccer_finland_veikkausliiga,soccer_league_of_ireland --market-profile=soccer-core --markets=h2h --edge=1 --sample-min-ev=-2 --sample-limit=50 --event-limit=15 --max-event-credits=60 --quota-floor=150 --telegram-watchlist
  if ($LASTEXITCODE -ne 0) {
    throw "betsson-oneapi-scan exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
