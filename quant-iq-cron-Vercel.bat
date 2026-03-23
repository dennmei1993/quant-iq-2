@echo off
:: ============================================================
:: Quant IQ — Cron Runner
:: Run 4x daily via Windows Task Scheduler:
::
::   Run 1 — 6:00 AM ET  (11:00 UTC) — Pre-market / overnight news
::   Run 2 — 9:00 AM ET  (14:00 UTC) — Market open / economic data
::   Run 3 — 12:00 PM ET (17:00 UTC) — Midday announcements
::   Run 4 — 5:00 PM ET  (22:00 UTC) — After-hours / earnings
::
:: Windows Task Scheduler setup:
::   Create 4 separate tasks, one for each run time above.
::   Each task points to this same .bat file.
:: ============================================================

:: ── Config — UPDATE THESE ─────────────────────────────────────────────────────
set APP_URL=https://www.betteroption.com.au
set CRON_SECRET=your_cron_secret_here

:: ── Log setup ─────────────────────────────────────────────────────────────────
set LOG_DIR=%~dp0logs
set LOG_FILE=%LOG_DIR%\cron_%date:~-4,4%%date:~-7,2%%date:~-10,2%.log
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo. >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"
echo [%date% %time%] Starting cron run >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"

:: ── Step 1: Ingest — fetch and classify news ─────────────────────────────────
echo [%date% %time%] Running ingest... >> "%LOG_FILE%"

curl -s -X GET "%APP_URL%/api/cron/ingest" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -w "\nHTTP Status: %%{http_code}\n" >> "%LOG_FILE%" 2>&1

echo [%date% %time%] Ingest complete. >> "%LOG_FILE%"

:: ── Wait 65 minutes for Claude to finish classifying ─────────────────────────
echo [%date% %time%] Waiting 65 min before themes... >> "%LOG_FILE%"
timeout /t 3900 /nobreak > nul

:: ── Step 2: Themes — generate themes and update signals ──────────────────────
echo [%date% %time%] Running themes... >> "%LOG_FILE%"

curl -s -X GET "%APP_URL%/api/cron/themes" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  -w "\nHTTP Status: %%{http_code}\n" >> "%LOG_FILE%" 2>&1

echo [%date% %time%] Themes complete. >> "%LOG_FILE%"
echo [%date% %time%] Cron run finished. >> "%LOG_FILE%"

:: ── Keep only last 30 log files ───────────────────────────────────────────────
for /f "skip=30 delims=" %%f in ('dir /b /o-d "%LOG_DIR%\cron_*.log"') do del "%LOG_DIR%\%%f"
