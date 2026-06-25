$ErrorActionPreference = 'Stop'
$HarnessRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HarnessRoot 'reports\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd'
$LogPath = Join-Path $LogDir "mispricing-scan-$Stamp.log"

Push-Location $HarnessRoot
try {
  Start-Transcript -Path $LogPath -Append | Out-Null
  node src/cli.mjs mispricing-scan
  if ($LASTEXITCODE -ne 0) {
    throw "mispricing-scan exited with code $LASTEXITCODE"
  }
} finally {
  try { Stop-Transcript | Out-Null } catch {}
  Pop-Location
}
