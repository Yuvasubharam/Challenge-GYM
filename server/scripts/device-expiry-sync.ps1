<#
Compare each member's expiry stored ON the eSSL X990 with the membership database, and fix mismatches.

The X990 keeps its own per-user validity (eTimeTrack "Device expiry", or set at the terminal). When
it has passed, the device recognises the finger and still refuses entry (ATTLOG status 254), even
though the app says the member is allowed. The cloud link (ADMS) can't see these dates, so this
script uses eSSL's SDK (zkemkeeper, installed with eTimeTrack Lite) over the gym LAN.

Run on the gym PC, on the gym network, from Challenge Gym\server:
  pwsh scripts\device-expiry-sync.ps1                 # dry run: report only, writes a CSV
  pwsh scripts\device-expiry-sync.ps1 -Apply          # write the expected dates to the device
  pwsh scripts\device-expiry-sync.ps1 -Only 487,210   # limit to some IDs (try one member first)

Mode (what the device should hold for each member):
  -Mode clear  (default, owner's choice 2026-10-02) allowed members get no device expiry: the cloud's
               automatic block/unblock alone controls the door. Expired members are left to the cloud.
  -Mode match  device end date = membership end date + grace days, expired members get their past
               date. Not recommended: a renewal made before expiry never reaches the device, so the
               member is locked out on the old date until this script is re-run.
Staff, "always allow" overrides and members without a plan: no device expiry.
#>
param(
  [switch]$Apply,
  [ValidateSet('match', 'clear')][string]$Mode = 'clear',
  [string[]]$Only = @(),
  [string]$DeviceIp = '192.168.0.215',
  [int]$Port = 4370,
  [string]$Config = 'wrangler.prod-device.toml'
)
$ErrorActionPreference = 'Stop'
if ([Environment]::Is64BitProcess -eq $false) { throw 'Run in 64-bit PowerShell (zkemkeeper is registered for 64-bit on this PC).' }

function D1([string]$sql) {
  $sql = ($sql -replace '\s+', ' ').Trim()   # newlines don't survive the Windows command line
  $out = npx wrangler d1 execute challenge-gym --remote -c $Config --json --command $sql 2>$null
  if ($LASTEXITCODE -ne 0) { throw "D1 query failed: $sql" }
  return ($out | ConvertFrom-Json)[0].results
}

# ── 1. What the database says ─────────────────────────────────────────────
Write-Host 'Reading members from the database…'
$grace = 0
$acc = D1 "SELECT value FROM settings WHERE key='access'"
if ($acc) { $g = ($acc[0].value | ConvertFrom-Json).grace_days; if ($g) { $grace = [int]$g } }
$today = (Get-Date).ToUniversalTime().AddMinutes(330).Date
$rows = D1 @"
SELECT m.essl_id, m.name, m.is_staff, m.access_override, m.frozen_from, m.frozen_until, m.device_state,
       (SELECT MAX(end_date) FROM memberships WHERE member_id=m.id AND status='active') AS end_date
FROM members m WHERE m.archived=0 AND m.essl_id IS NOT NULL
"@
$db = @{}
foreach ($r in $rows) { $db[[string]$r.essl_id] = $r }
Write-Host ("  {0} members, grace {1} day(s)" -f $db.Count, $grace)

function Expected($m) {
  # Returns @{ Expires = 0|1; End = [datetime] or $null; Why = text }
  if (-not $m) { return $null }                                   # on device but not a member: report only
  if ($m.is_staff -eq 1) { return @{ Expires = 0; End = $null; Why = 'staff' } }
  if ($m.access_override -eq 'allow') { return @{ Expires = 0; End = $null; Why = 'always allow' } }
  if (-not $m.end_date) { return @{ Expires = 0; End = $null; Why = 'no plan in DB' } }
  $end = [datetime]::ParseExact($m.end_date, 'yyyy-MM-dd', $null).AddDays($grace)
  $frozen = $m.frozen_from -and $m.frozen_until -and $today -ge [datetime]$m.frozen_from -and $today -le [datetime]$m.frozen_until
  $allowed = $m.access_override -ne 'deny' -and -not $frozen -and $end -ge $today
  if ($Mode -eq 'clear') {
    # Expired members are removed by the cloud's block; a past date here could lock out someone who
    # renews before that block runs (the app would see them as still on the device and send nothing).
    if (-not $allowed) { return @{ Skip = $true; Why = "expired $($m.end_date) — cloud blocks" } }
    return @{ Expires = 0; End = $null; Why = "allowed till $($m.end_date)" }
  }
  return @{ Expires = 1; End = $end; Why = $(if ($allowed) { "allowed till $($m.end_date)" } else { "expired $($m.end_date)" }) }
}

# ── 2. What the device holds ──────────────────────────────────────────────
$z = New-Object -ComObject zkemkeeper.ZKEM
Write-Host "Connecting to the X990 at ${DeviceIp}:$Port…"
if (-not $z.Connect_Net($DeviceIp, $Port)) {
  $e = 0; $z.GetLastError([ref]$e)
  throw "Could not connect (error $e). Be on the gym network; stop the gym-PC agent if it holds the connection."
}
$dateFmt = $null
$report = New-Object System.Collections.Generic.List[object]
try {
  [void]$z.ReadAllUserID(1)
  $pin = ''; $name = ''; $pw = ''; $pri = 0; $en = $false
  $device = @()
  while ($z.SSR_GetAllUserInfo(1, [ref]$pin, [ref]$name, [ref]$pw, [ref]$pri, [ref]$en)) { $device += [pscustomobject]@{ Pin = $pin; Name = $name; Enabled = $en } }
  Write-Host ("  {0} users on the device" -f $device.Count)

  foreach ($u in $device) {
    if ($Only.Count -and $Only -notcontains $u.Pin) { continue }
    $exp = 0; $cnt = 0; $s = ''; $e = ''
    $okRead = $z.GetUserValidDate(1, $u.Pin, [ref]$exp, [ref]$cnt, [ref]$s, [ref]$e)
    if ($okRead -and $e -and -not $dateFmt) { $dateFmt = $(if ($e.Length -gt 10) { 'yyyy-MM-dd HH:mm:ss' } else { 'yyyy-MM-dd' }) }
    $want = Expected $db[$u.Pin]
    $devEnd = $null; if ($okRead -and $exp -ne 0 -and $e) { try { $devEnd = [datetime]::Parse($e).Date } catch { } }
    $status =
      if (-not $want) { 'not in database' }
      elseif ($want.Skip) { 'left to cloud' }
      elseif (-not $okRead) { 'could not read' }
      elseif ($want.Expires -eq 0 -and $exp -eq 0) { 'ok' }
      elseif ($want.Expires -eq 1 -and $exp -ne 0 -and $devEnd -eq $want.End.Date) { 'ok' }
      else { 'MISMATCH' }
    $report.Add([pscustomobject]@{
      pin = $u.Pin; name = $u.Name; enabled_on_device = $u.Enabled
      device_expires = $exp; device_start = $s; device_end = $e
      db_end_date = $db[$u.Pin].end_date; db_reason = $want.Why
      want_expires = $want.Expires; want_end = $(if ($want.End) { $want.End.ToString('yyyy-MM-dd') } else { '' })
      status = $status
    })
  }

  $bad = @($report | Where-Object status -eq 'MISMATCH')
  $csv = Join-Path (Get-Location) ("device-expiry-report-{0:yyyyMMdd-HHmm}.csv" -f (Get-Date))
  $report | Export-Csv $csv -NoTypeInformation -Encoding utf8
  Write-Host ''
  $report | Group-Object status | ForEach-Object { Write-Host ("  {0,-16} {1}" -f $_.Name, $_.Count) }
  Write-Host "  Full report: $csv"
  if ($bad.Count) { $bad | Select-Object -First 40 pin, name, device_expires, device_end, db_end_date, want_end, db_reason | Format-Table -AutoSize | Out-String -Width 220 | Write-Host }

  # ── 3. Fix ──────────────────────────────────────────────────────────────
  if (-not $Apply) { Write-Host 'Dry run — nothing written. Re-run with -Apply to update the device.'; return }
  if (-not $bad.Count) { Write-Host 'Nothing to update.'; return }
  $fmt = $(if ($dateFmt) { $dateFmt } else { 'yyyy-MM-dd' })
  Write-Host ("Writing {0} user(s) to the device (date format {1})…" -f $bad.Count, $fmt)
  [void]$z.EnableDevice(1, $false)                     # pause the terminal while writing (a few seconds)
  $fixed = 0; $failed = 0
  try {
    foreach ($b in $bad) {
      $start = '2000-01-01'; $end = '2099-12-31'
      if ($b.want_expires -eq 1) { $end = $b.want_end }
      $s2 = [datetime]::Parse($start).ToString($fmt); $e2 = [datetime]::Parse($end).AddHours(23).AddMinutes(59).AddSeconds(59).ToString($fmt)
      if ($z.SetUserValidDate(1, $b.pin, [int]$b.want_expires, 0, $s2, $e2)) {
        $fixed++
      } else { $err = 0; $z.GetLastError([ref]$err); $failed++; Write-Host "  ✗ $($b.pin) $($b.name): error $err" }
    }
    [void]$z.RefreshData(1)
  } finally { [void]$z.EnableDevice(1, $true) }

  # Read back so the result is proven, not assumed
  $verified = 0
  foreach ($b in $bad) {
    $exp = 0; $cnt = 0; $s = ''; $e = ''
    if ($z.GetUserValidDate(1, $b.pin, [ref]$exp, [ref]$cnt, [ref]$s, [ref]$e)) {
      $devEnd = $null; if ($exp -ne 0 -and $e) { try { $devEnd = [datetime]::Parse($e).ToString('yyyy-MM-dd') } catch { } }
      if (($b.want_expires -eq 0 -and $exp -eq 0) -or ($b.want_expires -eq 1 -and $devEnd -eq $b.want_end)) { $verified++ }
      else { Write-Host "  ? $($b.pin) reads back expires=$exp end='$e'" }
    }
  }
  Write-Host ("Done: {0} written, {1} failed, {2} verified by reading back." -f $fixed, $failed, $verified)
} finally {
  $z.Disconnect()
}
