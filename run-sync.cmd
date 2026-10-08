@echo off
rem Entry point for Task Scheduler. Runs one sync from the project folder; output goes to logs\.
cd /d "%~dp0"
if not exist logs mkdir logs
"C:\Program Files\nodejs\node.exe" src\sync.mjs >> logs\scheduler.log 2>&1
exit /b %ERRORLEVEL%
