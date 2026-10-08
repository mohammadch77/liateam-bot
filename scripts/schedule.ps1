# Manage the Windows scheduled task that runs the sync every N hours.
#   powershell -ExecutionPolicy Bypass -File scripts\schedule.ps1 install [-Hours 4]
#   ... status | run | disable | enable | uninstall
param(
  [Parameter(Mandatory)][ValidateSet('install', 'status', 'run', 'disable', 'enable', 'uninstall')][string]$Action,
  [int]$Hours = 4
)
$ErrorActionPreference = 'Stop'
$TaskName = 'liateam-sync'
$Root = Split-Path -Parent $PSScriptRoot

switch ($Action) {
  'install' {
    $taskAction = New-ScheduledTaskAction -Execute (Join-Path $Root 'run-sync.cmd') -WorkingDirectory $Root
    # Start in 2 minutes, then repeat every $Hours hours indefinitely.
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours $Hours)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    # Runs as the current user, only while logged on (no stored password needed).
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $trigger -Settings $settings -Principal $principal `
      -Description "liateam price/stock sync every $Hours h" -Force | Out-Null
    Write-Output "Installed '$TaskName': every $Hours h, first run at $((Get-Date).AddMinutes(2).ToString('HH:mm'))"
  }
  'status' {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) { Write-Output "'$TaskName' is not installed"; break }
    $i = Get-ScheduledTaskInfo -TaskName $TaskName
    [pscustomobject]@{ Task = $TaskName; State = $t.State; LastRun = $i.LastRunTime; LastResult = $i.LastTaskResult; NextRun = $i.NextRunTime } | Format-List
    Write-Output 'LastResult: 0 = ok, 2 = warning, 1 = failed, 267011 = never ran'
  }
  'run'       { Start-ScheduledTask -TaskName $TaskName; Write-Output "Started '$TaskName' (see logs\scheduler.log)" }
  'disable'   { Disable-ScheduledTask -TaskName $TaskName | Out-Null; Write-Output "Disabled '$TaskName'" }
  'enable'    { Enable-ScheduledTask -TaskName $TaskName | Out-Null; Write-Output "Enabled '$TaskName'" }
  'uninstall' { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Output "Removed '$TaskName'" }
}
