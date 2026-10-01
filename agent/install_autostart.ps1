# Starts the Challenge Gym agent automatically (hidden, no console window) and keeps it running.
#   .\install_autostart.ps1              → start at Windows logon of this user (recommended)
#   .\install_autostart.ps1 -Remove      → remove the auto-start
#   .\install_autostart.ps1 -Status      → show whether it is installed / running
# The agent finds the X990 on the LAN by itself and syncs whenever the PC is on the gym network.
param([switch]$Remove, [switch]$Status)

$ErrorActionPreference = 'Stop'
$task = 'Challenge Gym Agent'
$dir = $PSScriptRoot

if ($Status) {
  $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  if (-not $t) { 'Not installed.'; exit }
  $i = $t | Get-ScheduledTaskInfo
  "Installed. State: $($t.State). Last run: $($i.LastRunTime). Last result: $($i.LastTaskResult)"
  if (Test-Path "$dir\agent_state.json") { 'Last device: ' + (Get-Content "$dir\agent_state.json" -Raw) }
  if (Test-Path "$dir\agent.log") { 'Recent log:'; Get-Content "$dir\agent.log" -Tail 8 }
  exit
}

if ($Remove) {
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  'Auto-start removed.'
  exit
}

if (-not (Test-Path "$dir\.env")) { throw "Create $dir\.env first (copy .env.example and fill CLOUD_URL + AGENT_TOKEN)." }

# pythonw.exe = Python without a console window. Prefer one that has the agent's packages.
$candidates = @()
foreach ($c in (Get-Command python.exe -All -ErrorAction SilentlyContinue)) { $candidates += $c.Source }
foreach ($v in (py -0p 2>$null)) { if ($v -match '([A-Z]:\\.+python\.exe)') { $candidates += $Matches[1] } }
$python = $null
foreach ($c in ($candidates | Where-Object { $_ -notmatch 'WindowsApps' } | Select-Object -Unique)) {
  & $c -c "import requests, zk" 2>$null
  if ($LASTEXITCODE -eq 0) { $python = $c; break }
}
if (-not $python) { throw 'No Python with the agent packages found. Run: pip install -r requirements.txt' }
$pythonw = Join-Path (Split-Path $python) 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }

$action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$dir\agent.py`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Challenge Gym: syncs the eSSL X990 with the cloud whenever this PC is on the gym network.' -Force | Out-Null
Start-ScheduledTask -TaskName $task
"Installed and started: '$task' (runs $pythonw at every logon, restarts if it stops)."
'Check it with: .\install_autostart.ps1 -Status   (log: agent\agent.log)'
