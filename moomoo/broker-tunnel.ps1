# broker-tunnel.ps1
# Expose broker bridge via Cloudflare Tunnel
# Run this AFTER broker_service.py is running

# Check if cloudflared is installed
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "Installing cloudflared..."
    winget install Cloudflare.cloudflared
}

Write-Host ""
Write-Host "Starting Cloudflare Tunnel for broker bridge..."
Write-Host "The tunnel URL will appear below — copy it to Vercel env vars"
Write-Host ""

cloudflared tunnel --url http://localhost:8765
