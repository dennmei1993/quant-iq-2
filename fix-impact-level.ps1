# fix-impact-level.ps1
# Run from your project root: .\fix-impact-level.ps1
# Replaces all impact_level references with impact_score equivalents

$files = Get-ChildItem -Path "src" -Recurse -Include "*.ts","*.tsx"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $original = $content

    # ── TypeScript type fields ────────────────────────────────────────────────
    $content = $content -replace 'impact_level\s*:\s*string \| null', 'impact_score: number | null'
    $content = $content -replace 'impact_level\s*\?:\s*string \| null', 'impact_score?: number | null'
    $content = $content -replace 'impact_level\s*:\s*string', 'impact_score: number'

    # ── Supabase .select() strings ────────────────────────────────────────────
    $content = $content -replace 'impact_level,\s*', 'impact_score, '
    $content = $content -replace ',\s*impact_level', ', impact_score'
    $content = $content -replace '"impact_level"', '"impact_score"'
    $content = $content -replace "'impact_level'", "'impact_score'"

    # ── .in("impact_level", ["high", "medium"]) → .gte("impact_score", 3) ────
    $content = $content -replace '\.in\("impact_level",\s*\["high",\s*"medium"\]\)', '.gte("impact_score", 3)'
    $content = $content -replace "\.in\('impact_level',\s*\['high',\s*'medium'\]\)", ".gte('impact_score', 3)"
    $content = $content -replace '\.in\("impact_level",\s*\["high",\s*"medium",\s*"low"\]\)', '.gte("impact_score", 1)'
    $content = $content -replace "\.in\('impact_level',\s*\['high',\s*'medium',\s*'low'\]\)", ".gte('impact_score', 1)"

    # ── .eq("impact_level", ...) → .eq("impact_score", ...) ──────────────────
    $content = $content -replace '\.eq\("impact_level"', '.eq("impact_score"'
    $content = $content -replace "\.eq\('impact_level'", ".eq('impact_score'"

    # ── impact_level === 'high' → impact_score >= 7 ───────────────────────────
    $content = $content -replace "impact_level === 'high'", 'impact_score >= 7'
    $content = $content -replace 'impact_level === "high"', 'impact_score >= 7'
    $content = $content -replace "impact_level === 'medium'", "(impact_score >= 4 && impact_score < 7)"
    $content = $content -replace 'impact_level === "medium"', '(impact_score >= 4 && impact_score < 7)'
    $content = $content -replace "impact_level === 'low'", 'impact_score < 4'
    $content = $content -replace 'impact_level === "low"', 'impact_score < 4'

    # ── impact_level ?? 'low' → impact_score ?? 1 ────────────────────────────
    $content = $content -replace "impact_level \?\? 'low'", 'impact_score ?? 1'
    $content = $content -replace 'impact_level \?\? "low"', 'impact_score ?? 1'

    # ── IMPACT_WEIGHT lookup by string → numeric thresholds ──────────────────
    # Replace: IMPACT_WEIGHT[e.impact_level ?? 'low'] ?? 0.2
    # With:    (e.impact_score ?? 1) >= 7 ? 1.0 : (e.impact_score ?? 1) >= 4 ? 0.5 : 0.2
    $content = $content -replace 'IMPACT_WEIGHT\[e\.impact_level \?\? .low.\] \?\? 0\.2', '((e.impact_score ?? 1) >= 7 ? 1.0 : (e.impact_score ?? 1) >= 4 ? 0.5 : 0.2)'
    $content = $content -replace 'IMPACT_WEIGHT\[a\.impact_level \?\? .low.\] \?\? 0\.2', '((a.impact_score ?? 1) >= 7 ? 1.0 : (a.impact_score ?? 1) >= 4 ? 0.5 : 0.2)'
    $content = $content -replace 'IMPACT_WEIGHT\[b\.impact_level \?\? .low.\] \?\? 0\.2', '((b.impact_score ?? 1) >= 7 ? 1.0 : (b.impact_score ?? 1) >= 4 ? 0.5 : 0.2)'
    $content = $content -replace 'IMPACT_WEIGHT\[topEvent\.impact_level \?\? .low.\] \?\? 0\.2', '((topEvent.impact_score ?? 1) >= 7 ? 1.0 : (topEvent.impact_score ?? 1) >= 4 ? 0.5 : 0.2)'

    # ── anchor.ts impact label ────────────────────────────────────────────────
    $content = $content -replace '\? `\$\{event\.impact_level\} impact`\s*: .notable impact.', '? `${event.impact_score}/10 impact` : "notable impact"'

    # ── Remaining bare impact_level property references ───────────────────────
    $content = $content -replace '\bimpact_level\b', 'impact_score'

    if ($content -ne $original) {
        Set-Content $file.FullName $content -NoNewline
        Write-Host "Fixed: $($file.FullName)"
    }
}

Write-Host ""
Write-Host "Done. Verifying no remaining impact_level references..."
$remaining = Get-ChildItem -Path "src" -Recurse -Include "*.ts","*.tsx" | Select-String "impact_level"
if ($remaining) {
    Write-Host "REMAINING REFERENCES:"
    $remaining | ForEach-Object { Write-Host "  $($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }
} else {
    Write-Host "All clear - no impact_level references remaining."
}
