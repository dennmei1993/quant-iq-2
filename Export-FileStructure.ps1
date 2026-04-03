# Export-FileStructure.ps1
param (
    [string]   $Root    = (Get-Location),
    [string]   $Output  = "file_structure.txt",
    [string[]] $Exclude = @("node_modules", ".git", ".next", "dist", "build", ".turbo")
)

function Get-Tree {
    param (
        [string] $Path,
        [string] $Indent = ""
    )

    $items = Get-ChildItem -Path $Path |
        Where-Object { $Exclude -notcontains $_.Name } |
        Sort-Object { -not $_.PSIsContainer }, Name

    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items[$i]
        $last = ($i -eq $items.Count - 1)

        if ($last) { $branch = "+-- " } else { $branch = "|-- " }

        $line = "$Indent$branch$($item.Name)"
        $line

        if ($item.PSIsContainer) {
            if ($last) { $nextIndent = "$Indent    " } else { $nextIndent = "$Indent|   " }
            Get-Tree -Path $item.FullName -Indent $nextIndent
        }
    }
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$rootName  = Split-Path $Root -Leaf

$lines = @()
$lines += "File Structure"
$lines += "Generated : $timestamp"
$lines += "Root      : $Root"
$lines += "Excluded  : $($Exclude -join ', ')"
$lines += ""
$lines += "$rootName/"
$lines += Get-Tree -Path $Root

$lines | Out-File -FilePath $Output -Encoding utf8

Write-Host "Done. Written to: $Output"
