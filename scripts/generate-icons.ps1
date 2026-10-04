Add-Type -AssemblyName System.Drawing

function Generate-Icon([int]$size, [string]$outFile) {
    $bmp = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background #20222c
    $bgBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#20222c"))
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Parity Bars #6fdcae
    $barBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#6fdcae"))
    $barWidth = [int]($size * 0.56)
    $barHeight = [int]($size * 0.11)
    $barX = [int]($size * 0.22)
    $barY1 = [int]($size * 0.34)
    $barY2 = [int]($size * 0.55)

    $g.FillRectangle($barBrush, $barX, $barY1, $barWidth, $barHeight)
    $g.FillRectangle($barBrush, $barX, $barY2, $barWidth, $barHeight)

    $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Generated $outFile"
}

Generate-Icon 192 "public\icon-192.png"
Generate-Icon 512 "public\icon-512.png"
Copy-Item "app\icon.svg" "public\icon.svg" -Force
Write-Output "Copied icon.svg to public"
