# restore-db.ps1
# Restores QuantIQ tables from CSV backup files into a Supabase project.
# Run AFTER running the schema migrations (001_schema.sql + 002_data_engine.sql).
#
# Usage:
#   PowerShell -ExecutionPolicy Bypass -File .\restore-db.ps1 -BackupDir ".\quant-iq-backup-2026-04-01"

param (
  [Parameter(Mandatory=$true)]
  [string]$SupabaseUrl,

  [Parameter(Mandatory=$true)]
  [string]$ServiceRoleKey,

  [Parameter(Mandatory=$true)]
  [string]$BackupDir,

  [int]$BatchSize = 500   # rows per upsert — keep low to avoid payload limits
)

$headers = @{
  "apikey"        = $ServiceRoleKey
  "Authorization" = "Bearer $ServiceRoleKey"
  "Content-Type"  = "application/json"
  "Prefer"        = "resolution=merge-duplicates"
}

# Restore order matters — parent tables before child tables
$tables = @(
  "assets",          # no FK deps
  "asset_signals",   # depends on assets
  "themes",          # no FK deps
  "events",          # no FK deps
  "daily_prices",    # depends on assets (largest — takes longest)
  "profiles",        # depends on auth.users
  "portfolios",      # depends on profiles
  "holdings",        # depends on portfolios
  "advisory_memos",  # depends on profiles, portfolios
  "alerts",          # depends on profiles
  "subscriptions",   # depends on profiles
  "user_watchlist",  # depends on profiles, assets
  "macro_scores",    # no FK deps
  "theme_tickers"    # depends on themes, assets
)

Write-Host ""
Write-Host "========================================"
Write-Host " QuantIQ DB Restore"
Write-Host " Source: $BackupDir"
Write-Host "========================================"
Write-Host ""

$totalUpserted = 0
$startTime     = Get-Date

foreach ($table in $tables) {
  $csvFile = "$BackupDir\$table.csv"

  if (-not (Test-Path $csvFile)) {
    Write-Host "$table — skipped (no CSV found)" -ForegroundColor Yellow
    continue
  }

  $rows = Import-Csv $csvFile
  if ($rows.Count -eq 0) {
    Write-Host "$table — skipped (empty)" -ForegroundColor Yellow
    continue
  }

  Write-Host "$table — $($rows.Count) rows..." -NoNewline

  $upserted  = 0
  $failed    = 0
  $url       = "$SupabaseUrl/rest/v1/$table"

  # Process in batches
  for ($i = 0; $i -lt $rows.Count; $i += $BatchSize) {
    $batch = $rows[$i..([Math]::Min($i + $BatchSize - 1, $rows.Count - 1))]
    $body  = $batch | ConvertTo-Json -Depth 5

    # Wrap single object in array
    if ($batch.Count -eq 1) { $body = "[$body]" }

    try {
      $response = Invoke-WebRequest -Uri $url `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -UseBasicParsing

      if ($response.StatusCode -in 200, 201) {
        $upserted += $batch.Count
      }
    } catch {
      $failed += $batch.Count
      Write-Host " BATCH ERROR at row $i`: $($_.Exception.Message)" -ForegroundColor Red
    }
  }

  $totalUpserted += $upserted
  $status = if ($failed -eq 0) { "Green" } else { "Yellow" }
  Write-Host " $upserted upserted, $failed failed" -ForegroundColor $status
}

$elapsed = [math]::Round(((Get-Date) - $startTime).TotalMinutes, 1)
Write-Host ""
Write-Host "========================================"
Write-Host " Restore complete!"
Write-Host " Total upserted: $totalUpserted"
Write-Host " Duration:       ${elapsed}m"
Write-Host "========================================"
Write-Host ""
Write-Host "NOTE: profiles and user-owned tables require"
Write-Host "auth.users to exist first. Re-invite users"
Write-Host "if their data is missing after restore."
