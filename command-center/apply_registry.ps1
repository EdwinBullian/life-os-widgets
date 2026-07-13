<#
.SYNOPSIS
  Reconcile the LifeOS registry (declared state) into live Windows Scheduled
  Tasks (actual state). The apply half of the ACC control loop (doc 23 sec 3,
  P4.8): the dashboard flips `enabled` in registry.json via the ACC bus
  consumer, and this script makes that flip LIVE on the always-on laptop.

.DESCRIPTION
  Idempotent and dry-run by default. For every registry row that names a Windows
  Scheduled Task via a `winTask` field, it compares the declared `enabled` state
  against the task's actual state and enables/disables to match.

  SAFETY:
    * Dry-run unless -Apply is passed --prints the plan, changes nothing.
    * Only touches tasks named by a `winTask` field. Rows without it (the vast
      majority, still declared-not-armed) are ignored --this script never
      CREATES or DELETES a task, only enables/disables an existing one.
    * Cron DRIFT is REPORTED, never auto-applied: translating an arbitrary cron
      expression into a Scheduled-Task trigger is error-prone and silently
      breaking a schedule is worse than flagging it. Re-register the trigger by
      hand (or via the row's install script) when cron drift is reported.

.PARAMETER Apply
  Actually enable/disable tasks. Without it, the script only reports.

.PARAMETER RegistryPath
  Override the registry.json location (defaults to the sibling data/registry.json).

.EXAMPLE
  powershell -File apply_registry.ps1            # dry-run: show the plan
  powershell -File apply_registry.ps1 -Apply     # execute enable/disable
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$RegistryPath
)

$ErrorActionPreference = 'Stop'

if (-not $RegistryPath) {
    $RegistryPath = Join-Path $PSScriptRoot 'data\registry.json'
}
if (-not (Test-Path $RegistryPath)) {
    Write-Error "registry not found: $RegistryPath"
    exit 2
}

$registry = Get-Content -Raw -Encoding UTF8 $RegistryPath | ConvertFrom-Json

if ($registry.global_pause) {
    Write-Host "NOTE: registry.global_pause is TRUE --the kill switch is engaged." -ForegroundColor Yellow
    Write-Host "      run.py exits early for every non-exempt job regardless of task state." -ForegroundColor Yellow
    Write-Host ""
}

$mode = if ($Apply) { 'APPLY' } else { 'DRY-RUN' }
Write-Host "apply_registry ($mode) over $($registry.tasks.Count) rows" -ForegroundColor Cyan
Write-Host ""

$planned = 0
$changed = 0
$cronDrift = 0
$missing = 0
$failed = 0

function Get-TaskEnabled([string]$name) {
    # Returns $true / $false / $null (task not found). schtasks is used over the
    # ScheduledTasks module for parity with how these tasks were registered.
    $out = & schtasks /Query /TN $name /FO LIST /V 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    $statusLine = $out | Where-Object { $_ -match '^\s*Scheduled Task State:' } | Select-Object -First 1
    if (-not $statusLine) {
        $statusLine = $out | Where-Object { $_ -match '^\s*Status:' } | Select-Object -First 1
    }
    return ($statusLine -match 'Enabled')
}

foreach ($task in $registry.tasks) {
    $winTask = $task.winTask
    if (-not $winTask) { continue }   # only reconcile rows that name a Win task
    if ($null -eq $task.enabled) {    # never infer disabled from a missing field
        Write-Host "  [skip] $($task.id) ('$winTask'): no 'enabled' field -- not touching." -ForegroundColor DarkGray
        continue
    }

    $declaredEnabled = [bool]$task.enabled
    $actualEnabled = Get-TaskEnabled $winTask

    if ($null -eq $actualEnabled) {
        Write-Host "  [MISSING] $($task.id): Scheduled Task '$winTask' not found --register it first." -ForegroundColor Red
        $missing++
        continue
    }

    if ($declaredEnabled -ne $actualEnabled) {
        $planned++
        $verb = if ($declaredEnabled) { 'ENABLE' } else { 'DISABLE' }
        Write-Host "  [$verb] $($task.id) ('$winTask'): declared=$declaredEnabled actual=$actualEnabled"
        if ($Apply) {
            $flag = if ($declaredEnabled) { '/ENABLE' } else { '/DISABLE' }
            & schtasks /Change /TN $winTask $flag | Out-Null
            if ($LASTEXITCODE -eq 0) { $changed++ }
            else { Write-Host "      FAILED to change '$winTask'" -ForegroundColor Red; $failed++ }
        }
    } else {
        Write-Host "  [ok] $($task.id) ('$winTask'): enabled=$declaredEnabled" -ForegroundColor DarkGray
    }

    # Cron drift is reported only (see .DESCRIPTION safety note).
    if ($task.observedCron -and $task.cron -and ($task.observedCron -ne $task.cron)) {
        Write-Host "      cron drift: declared '$($task.cron)' vs observed '$($task.observedCron)' --re-register the trigger by hand." -ForegroundColor Yellow
        $cronDrift++
    }
}

Write-Host ""
Write-Host "summary: planned=$planned changed=$changed failed=$failed cronDrift=$cronDrift missing=$missing" -ForegroundColor Cyan
if (-not $Apply -and $planned -gt 0) {
    Write-Host "re-run with -Apply to execute the $planned enable/disable change(s)." -ForegroundColor Cyan
}
if ($failed -gt 0) { exit 1 }
exit 0
