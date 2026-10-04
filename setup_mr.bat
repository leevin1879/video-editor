@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Cai bo tach giong hat (MR) cho VEdit
echo Cai moi truong rieng sep-env (torch GPU + demucs). Tai khoang 2.5GB, chi can lam 1 lan.
echo.
if not exist sep-env\Scripts\python.exe (
  python -m venv sep-env || goto :err
)
sep-env\Scripts\python.exe -m pip install --upgrade pip || goto :err
rem Co card NVIDIA -> ban GPU (nhanh); khong co -> ban CPU
where nvidia-smi >nul 2>nul
if %errorlevel%==0 (
  sep-env\Scripts\python.exe -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121 || goto :err
) else (
  sep-env\Scripts\python.exe -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu || goto :err
)
sep-env\Scripts\python.exe -m pip install demucs soundfile || goto :err
sep-env\Scripts\python.exe -c "import torch,demucs;print('OK - GPU:', torch.cuda.is_available())" || goto :err
echo.
echo Cai xong! Mo lai VEdit (F5) roi dung nut MR.
pause
exit /b 0
:err
echo.
echo [LOI] Cai dat that bai. Chup man hinh gui lai.
pause
exit /b 1
