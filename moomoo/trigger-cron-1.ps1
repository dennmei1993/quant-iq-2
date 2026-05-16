# moomoo/trigger-cron.ps1
# Called by Windows Task Scheduler every minute during US market hours

$url = "https://www.betteroption.com.au/api/cron/conditional-orders"
$secret = "YOUR_CRON_SECRET"
$logFile = "$PSScriptRoot\cron.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$day = (Get-Date).DayOfWeek
if ($day -eq "Saturday" -or $day -eq "Sunday") { exit 0 }

try {
    $headers = @{ Authorization = "Bearer $secret" }
    $response = Invoke-RestMethod -Uri $url -Method GET -Headers $headers -TimeoutSec 30

    if ($response.skipped) {
        $minute = (Get-Date).Minute
        if ($minute -eq 0) {
            Add-Content -Path $logFile -Value ($timestamp + " | skipped - " + $response.reason)
        }
    } else {
        $msg = $timestamp + " | checked=" + $response.checked + " executed=" + $response.executed + " et=" + $response.et_time
        $detail = $response | ConvertTo-Json -Compress -Depth 5
        Add-Content -Path $logFile -Value $msg
        Add-Content -Path $logFile -Value ("  DETAIL: " + $detail)
        Write-Host $msg
        Write-Host ("  DETAIL: " + $detail)
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
