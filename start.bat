@echo off
chcp 65001 >nul
cd /d "%~dp0"
title VEdit - Video Editor (DUNG TAT CUA SO NAY khi dang dung app)

rem App da chay san -> chi mo trinh duyet
netstat -ano | findstr /r /c:"127.0.0.1:8765 .*LISTENING" >nul
if %errorlevel%==0 (
  echo VEdit dang chay san. Dang mo trinh duyet...
  start "" http://127.0.0.1:8765/
  timeout /t 3 >nul
  exit /b
)

where python >nul 2>nul
if errorlevel 1 (
  echo [LOI] Khong tim thay Python. Hay cai Python roi chay lai.
  pause
  exit /b 1
)

echo Dang khoi dong VEdit... Trinh duyet se tu mo.
echo Giu cua so nay mo trong luc dung app. Tat cua so = tat app.
echo.
python -u server.py
echo.
echo [!] Server da dung. Neu co loi o tren, chup man hinh gui lai.
pause
