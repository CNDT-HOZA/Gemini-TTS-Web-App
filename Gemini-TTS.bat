@echo off
chcp 65001 >nul 2>&1
title Gemini TTS

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Chua cai Node.js! Tai tai: https://nodejs.org
    pause
    exit /b 1
)

:: Kill any existing server on port 5500
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5500 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Open browser
start "" "http://localhost:5500"

:: Start server minimized (this window will close)
start /min "Gemini TTS Server" cmd /c "cd /d "%~dp0" && node server.js"

exit
