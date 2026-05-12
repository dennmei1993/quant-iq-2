# broker-start.ps1 — Start the Quant IQ broker bridge
#
# DEV:  READ=real, WRITE=simulate — no real money at risk
# PROD: set WRITE_ACCOUNT = REAL_ACCOUNT_ID to go live

$env:OPEND_HOST          = "127.0.0.1"
$env:OPEND_PORT          = "11111"
$env:SERVICE_PORT        = "8765"
$env:INITIAL_CASH        = "100000"
$env:SLIPPAGE_BPS        = "2.0"
$env:MAX_DAILY_TRADES    = "1"
$env:MAX_POSITION_PCT    = "5.0"

$env:READ_ACCOUNT        = ""        # auto-detected from OpenD
$env:WRITE_ACCOUNT       = ""        # auto-detected from OpenD
$env:TRADE_PWD           = "210195"  # 6-digit trade PIN — auto-unlocks on startup

# PROD: uncomment and set
# $env:READ_ACCOUNT  = "your_real_acc_id"
# $env:WRITE_ACCOUNT = "your_real_acc_id"
# $env:TRADE_PWD     = "your_trade_pin"

$mode = if ($env:WRITE_ACCOUNT -and ($env:WRITE_ACCOUNT -eq $env:READ_ACCOUNT)) { "PRODUCTION (LIVE)" } else { "DEVELOPMENT (paper)" }

Write-Host ""
Write-Host "  Quant IQ Broker Bridge"
Write-Host "  ──────────────────────────────────"
Write-Host "  Mode:    $mode"
Write-Host "  OpenD:   $env:OPEND_HOST`:$env:OPEND_PORT"
Write-Host "  Service: http://localhost:$env:SERVICE_PORT"
Write-Host "  Docs:    http://localhost:$env:SERVICE_PORT/docs"
Write-Host ""

python broker_service.py
