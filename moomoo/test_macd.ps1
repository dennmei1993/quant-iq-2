# test_macd.ps1 — run from PowerShell to debug MACD values
# Usage: .\test_macd.ps1 -ticker TQQQ

param([string]$ticker = "TQQQ")

$r = Invoke-RestMethod -Uri "http://localhost:8765/kline?symbol=US.$ticker&kl_type=60M&count=500"
Write-Host "Candles: $($r.count) | From: $($r.start) | To: $($r.end)"

$closes = $r.klines | ForEach-Object { [double]$_.close }
Write-Host "Last 5 closes: $($closes[-5..-1] -join ', ')"

# EMA seeded with SMA
function Get-EMA($values, $period) {
    $k    = 2.0 / ($period + 1)
    $seed = ($values[0..($period-1)] | Measure-Object -Sum).Sum / $period
    $result = @([double]::NaN) * ($period - 1) + @($seed)
    for ($i = $period; $i -lt $values.Count; $i++) {
        $result += $values[$i] * $k + $result[-1] * (1 - $k)
    }
    return $result
}

$fast = Get-EMA $closes 12
$slow = Get-EMA $closes 26

# MACD line from index 25 onwards
$macdLine = @()
for ($i = 25; $i -lt $closes.Count; $i++) {
    $macdLine += $fast[$i] - $slow[$i]
}

$signalLine = Get-EMA $macdLine 9

$n = [Math]::Min($macdLine.Count, $signalLine.Count)
$currMacd   = $macdLine[$n-1]
$currSignal = $signalLine[$n-1]
$prevMacd   = $macdLine[$n-2]
$prevSignal = $signalLine[$n-2]

Write-Host ""
Write-Host "=== MACD (12,26,9) on 1H ==="
Write-Host ("Prev: MACD {0:F4} | Signal {1:F4} | Hist {2:F4}" -f $prevMacd, $prevSignal, ($prevMacd - $prevSignal))
Write-Host ("Curr: MACD {0:F4} | Signal {1:F4} | Hist {2:F4}" -f $currMacd, $currSignal, ($currMacd - $currSignal))
Write-Host ""

$bullish = $prevMacd -lt $prevSignal -and $currMacd -gt $currSignal
$bearish = $prevMacd -gt $prevSignal -and $currMacd -lt $currSignal
Write-Host "Bullish cross: $bullish"
Write-Host "Bearish cross: $bearish"
