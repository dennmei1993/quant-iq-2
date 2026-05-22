# broker-tunnel.ps1
# Expose broker bridge via Cloudflare Tunnel
# Run this AFTER broker_service.py is running

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "Installing cloudflared..."
    winget install Cloudflare.cloudflared
}

$urlFile = "$PSScriptRoot\tunnel-url.txt"

Write-Host ""
Write-Host "Starting Cloudflare Tunnel for broker bridge..."
Write-Host "Tunnel URL will be saved to: $urlFile"
Write-Host ""

# Run cloudflared and capture output to detect the URL
$process = Start-Process -FilePath "cloudflared" `
    -ArgumentList "tunnel --url http://localhost:8765" `
    -PassThru -NoNewWindow `
    -RedirectStandardError "$PSScriptRoot\cloudflared.log"

# Wait for URL to appear in log
$timeout = 30
$elapsed = 0
$tunnelUrl = $null

while ($elapsed -lt $timeout -and -not $tunnelUrl) {
    Start-Sleep 1
    $elapsed++
    if (Test-Path "$PSScriptRoot\cloudflared.log") {
        $logContent = Get-Content "$PSScriptRoot\cloudflared.log" -Raw -ErrorAction SilentlyContinue
        if ($logContent -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
            $tunnelUrl = $matches[0]
        }
    }
}

if ($tunnelUrl) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Tunnel URL: $tunnelUrl" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    
    # Save URL to file
    $tunnelUrl | Set-Content $urlFile
    Write-Host "URL saved to $urlFile"
    Write-Host ""
    Write-Host "Set this in Vercel env vars:" -ForegroundColor Yellow
    Write-Host "  BRIDGE_URL = $tunnelUrl" -ForegroundColor Yellow
    Write-Host ""
    
    # Copy to clipboard
    $tunnelUrl | Set-Clipboard
    Write-Host "URL copied to clipboard!" -ForegroundColor Cyan
} else {
    Write-Host "Could not detect tunnel URL after ${timeout}s" -ForegroundColor Red
    Write-Host "Check cloudflared.log for details"
}

# Keep process running
Write-Host "Tunnel running (PID: $($process.Id)). Press Ctrl+C to stop."
Wait-Process -Id $process.Id
