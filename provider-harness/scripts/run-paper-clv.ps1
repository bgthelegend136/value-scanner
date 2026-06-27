$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "paper-clv-$Stamp.log"

# Paper-only CLV capture. Use a wider 40-minute paper window to reduce missed
# captures while leaving the live mispricing CLV window unchanged.
Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node src/cli.mjs clv --window-minutes=40
  if ($LASTEXITCODE -ne 0) {
    throw "clv exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
