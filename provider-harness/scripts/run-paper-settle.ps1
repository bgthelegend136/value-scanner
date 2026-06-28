$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "paper-settle-$Stamp.log"

# Settlement: update completed paper bets and sent Telegram alerts from final
# scores. Sends nothing to Telegram and never touches the Telegram alert floor.
# fd-settle runs first to settle soccer for FREE via football-data.org, so the
# subsequent The Odds API `settle` only spends credits on non-soccer leftovers.
Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node src/cli.mjs fd-settle
  if ($LASTEXITCODE -ne 0) {
    throw "fd-settle exited with code $LASTEXITCODE"
  }
  node src/cli.mjs settle
  if ($LASTEXITCODE -ne 0) {
    throw "settle exited with code $LASTEXITCODE"
  }
  node src/cli.mjs mispricing-settle
  if ($LASTEXITCODE -ne 0) {
    throw "mispricing-settle exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
