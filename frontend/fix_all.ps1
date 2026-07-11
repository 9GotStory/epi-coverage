$ErrorActionPreference = "Stop"

function Fix-File {
    param ($path)
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $bytes = $bytes[3..($bytes.Length - 1)] }
    $content = [System.Text.Encoding]::UTF8.GetString($bytes)

    if ($content -match "เธ") {
        $lines = $content -split "`n"
        $out = @()
        foreach ($l in $lines) {
            # Skip if it doesn't have mojibake
            if ($l -match "เธ") {
                $ob = [System.Text.Encoding]::Default.GetBytes($l)
                $dec = [System.Text.Encoding]::UTF8.GetString($ob)
                if ($dec -match "" -or $dec -match "๏ฟฝ" -or $dec.Contains([char]0xFFFD)) {
                    $out += $l
                } else {
                    $out += $dec
                }
            } else {
                $out += $l
            }
        }
        $res = $out -join "`n"
        [System.IO.File]::WriteAllText($path, $res, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Fixed $path"
    }
}

Get-ChildItem -Path "c:\Users\9GotStory-Swift\Desktop\Local Disk\Dev\epi-coverage\frontend\src\features" -Recurse -Filter *.tsx | ForEach-Object {
    Fix-File $_.FullName
}
Write-Host "Done"
