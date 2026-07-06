@echo off
chcp 65001 >nul 2>&1
title Gemini TTS - Voice Studio

echo.
echo   ╔══════════════════════════════════════════════╗
echo   ║     🎙️  Gemini TTS - Voice Studio            ║
echo   ║         Đang khởi động...                     ║
echo   ╚══════════════════════════════════════════════╝
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   ❌ Chưa cài Node.js!
    echo.
    echo   Hãy tải Node.js tại: https://nodejs.org
    echo   Chọn bản LTS, cài xong chạy lại file này.
    echo.
    pause
    exit /b 1
)

:: Kill any existing server on port 5500
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5500 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Open browser after 1 second
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:5500"

:: Start server
cd /d "%~dp0"
node server.js

pause
