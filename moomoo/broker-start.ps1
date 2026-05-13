# broker-start.ps1 — Start the Quant IQ broker bridge
# Trade PIN is stored in user profile (Settings page) and passed via API
# No need to set TRADE_PWD here anymore

$env:OPEND_HOST          = "127.0.0.1"
$env:OPEND_PORT          = "11111"
$env:SERVICE_PORT        = "8765"
$env:INITIAL_CASH        = "100000"
$env:SLIPPAGE_BPS        = "2.0"
$env:MAX_DAILY_TRADES    = "1"
$env:MAX_POSITION_PCT    = "5.0"

# TRADE_PWD is no longer needed here — it's read from user profile in Supabase
# and injected by the Next.js proxy route for each order request

Write-Host ""
Write-Host "  Quant IQ Broker Bridge"
Write-Host "  ──────────────────────────────────"
Write-Host "  OpenD:   $env:OPEND_HOST`:$env:OPEND_PORT"
Write-Host "  Service: http://localhost:$env:SERVICE_PORT"
Write-Host "  Trade PIN: from user profile (Settings page)"
Write-Host ""

python broker_service.py
