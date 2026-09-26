# Local test helper: keeps a worker running and restarts it if wrangler exits.
# (wrangler 3 can crash when several `wrangler dev` instances share its dev registry.)
#   .\run-local.ps1 device   → eSSL/agent worker on :8790 (reachable from the LAN for the X990)
#   .\run-local.ps1 admin    → admin API on :8788
param([ValidateSet('device', 'admin', 'member')][string]$Worker = 'device')

$wranglerArgs = switch ($Worker) {
  'device' { @('-c', 'wrangler.device.toml', '--port', '8790', '--ip', '0.0.0.0', '--inspector-port', '9229', '--test-scheduled') }
  'admin'  { @('-c', 'wrangler.admin.toml', '--port', '8788', '--inspector-port', '9230') }
  'member' { @('-c', 'wrangler.member.toml', '--port', '8789', '--inspector-port', '9231', '--var', 'JWT_SECRET:dev-member-secret-different-from-admin') }
}
Set-Location $PSScriptRoot
while ($true) {
  Write-Host "[$(Get-Date -Format HH:mm:ss)] starting $Worker worker" -ForegroundColor Green
  npx wrangler dev @wranglerArgs --persist-to .wrangler/state
  Write-Host "[$(Get-Date -Format HH:mm:ss)] $Worker worker exited ($LASTEXITCODE) — restarting in 3s" -ForegroundColor Yellow
  Start-Sleep 3
}
