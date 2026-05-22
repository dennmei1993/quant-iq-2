# moomoo/broker-start.ps1
# Start the Quant IQ broker bridge

# ── Supabase credentials ──────────────────────────────────────────────────────
$env:SUPABASE_URL         = "https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_KEY = "YOUR_SERVICE_ROLE_KEY"
$env:PYTHONIOENCODING     = "utf-8"

# ── Start broker bridge ───────────────────────────────────────────────────────
Write-Host "Starting Quant IQ Broker Bridge..." -ForegroundColor Cyan
Write-Host "Run broker-tunnel.ps1 in a separate terminal to expose via Cloudflare." -ForegroundColor Yellow
Write-Host ""

Set-Location $PSScriptRoot
python broker_service.py
