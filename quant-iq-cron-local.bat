@echo off
:: ============================================================
:: Quant IQ — Cron Runner
:: Run this with Windows Task Scheduler to trigger daily crons
::
:: Schedule:
::   Ingest:  8:00 AM UTC daily
::   Themes:  9:00 AM UTC daily (runs 65 min after ingest)
::
:: Setup in Task Scheduler:
::   1. Open Task Scheduler → Create Task
::   2. Triggers → New → Daily → set time to 8:00 AM UTC
::   3. Actions → New → Start a program → browse to this .bat file
::   4. Conditions → uncheck "Start only if on AC power"
::   5. Settings → check "Run task as soon as possible after scheduled start is missed"
:: ============================================================

:: ── Config ────────────────────────────────────────────────────────────────────
set APP_URL=https://quant-iq.vercel.app
set CRON_SECRET=a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5
set LOG_DIR=%~dp0logs
set LOG_FILE=%LOG_DIR%\cron_%date:~-4,4%%date:~-7,2%%date:~-10,2%.log

:: ── Create logs folder if it doesn't exist ────────────────────────────────────
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: ── Log start ─────────────────────────────────────────────────────────────────
echo. >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"
echo [%date% %time%] Starting Quant IQ cron run >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"

:: ── Step 1: Run ingest cron ───────────────────────────────────────────────────
echo [%date% %time%] Running ingest... >> "%LOG_FILE%"

curl -s -X GET "%APP_URL%/api/cron/ingest" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -w "\nHTTP Status: %%{http_code}\n" >> "%LOG_FILE%" 2>&1

echo [%date% %time%] Ingest complete. >> "%LOG_FILE%"

:: ── Wait 65 minutes before running themes ────────────────────────────────────
:: (gives Claude time to classify all events before theme generation)
echo [%date% %time%] Waiting 65 minutes before themes cron... >> "%LOG_FILE%"
timeout /t 3900 /nobreak > nul

:: ── Step 2: Run themes cron ───────────────────────────────────────────────────
echo [%date% %time%] Running themes... >> "%LOG_FILE%"

curl -s -X GET "%APP_URL%/api/cron/themes" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -w "\nHTTP Status: %%{http_code}\n" >> "%LOG_FILE%" 2>&1

echo [%date% %time%] Themes complete. >> "%LOG_FILE%"
echo [%date% %time%] Cron run finished. >> "%LOG_FILE%"

:: ── Keep only last 30 log files ───────────────────────────────────────────────
for /f "skip=30 delims=" %%f in ('dir /b /o-d "%LOG_DIR%\cron_*.log"') do del "%LOG_DIR%\%%f"
