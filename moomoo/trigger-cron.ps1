# moomoo/trigger-cron.ps1
# Called by Windows Task Scheduler every minute during US market hours

$url = "https://www.betteroption.com.au/api/cron/conditional-orders"
$secret = "a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5"
$logFile = "$PSScriptRoot\cron.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# $day = (Get-Date).DayOfWeek
# if ($day -eq "Saturday" -or $day -eq "Sunday") { exit 0 }

try {
    $headers = @{ Authorization = "Bearer $secret" }
    $response = Invoke-RestMethod -Uri $url -Method GET -Headers $headers -TimeoutSec 30

    if ($response.skipped) {
        $msg = $timestamp + " | skipped - " + $response.reason
        Add-Content -Path $logFile -Value $msg
        Write-Host $msg
    } else {
        $msg = $timestamp + " | checked=" + $response.checked + " executed=" + $response.executed + " et=" + $response.et_time
        if ($response.executed -gt 0) {
            $msg = $msg + " | ORDERS EXECUTED"
        }
        Add-Content -Path $logFile -Value $msg
        Write-Host $msg
    }
} catch {
    $errMsg = $timestamp + " | ERROR: " + $_.Exception.Message
    Add-Content -Path $logFile -Value $errMsg
    Write-Host $errMsg
}

if (Test-Path $logFile) {
    $lines = Get-Content $logFile
    if ($lines.Count -gt 1000) {
        $lines | Select-Object -Last 1000 | Set-Content $logFile
    }
}
