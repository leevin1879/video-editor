@echo off
cd /d "%~dp0"
if not exist "plugins\vedit\mcp.json" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-plugin.ps1"
if errorlevel 1 exit /b 1
"%~dp0plugin-env\Scripts\python.exe" "%~dp0plugins\vedit\server.py" --http
