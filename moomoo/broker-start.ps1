# moomoo/broker-start.ps1
# Start the Quant IQ broker bridge with all required env vars

# ── Supabase credentials (required for conditional order monitor) ──
$env:SUPABASE_URL         = "https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_KEY = "YOUR_SERVICE_ROLE_KEY"

# ── Start bridge ──
Write-Host "Starting Quant IQ Broker Bridge..." -ForegroundColor Cyan
python broker_service.py
