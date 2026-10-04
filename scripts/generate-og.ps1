Add-Type -AssemblyName System.Drawing

$width = 1200
$height = 630
$bmp = [System.Drawing.Bitmap]::new($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Dark Background
$bgBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#11131c"))
$g.FillRectangle($bgBrush, 0, 0, $width, $height)

# Mint Glow
$glowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(25, 111, 220, 174))
$g.FillEllipse($glowBrush, 850, -100, 450, 450)

# Outer Border
$borderPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#262938"), [single]2)
$g.DrawRectangle($borderPen, 24, 24, $width - 48, $height - 48)

# Logo Tile
$tileBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#1e2230"))
$tilePen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#383d54"), [single]2)
$g.FillRectangle($tileBrush, 90, 85, 72, 72)
$g.DrawRectangle($tilePen, 90, 85, 72, 72)

# Logo Bars (#6fdcae)
$barBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#6fdcae"))
$g.FillRectangle($barBrush, 106, 108, 40, 9)
$g.FillRectangle($barBrush, 106, 126, 40, 9)

# Brand Name
$brandFont = [System.Drawing.Font]::new("Segoe UI", [single]32, [System.Drawing.FontStyle]::Bold)
$whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#ffffff"))
$g.DrawString("SQLParity", $brandFont, $whiteBrush, [single]180, [single]95)

# Main Headline
$headlineFont = [System.Drawing.Font]::new("Segoe UI", [single]46, [System.Drawing.FontStyle]::Bold)
$g.DrawString("SQL tools that never see your data.", $headlineFont, $whiteBrush, [single]90, [single]200)

# Subtitle
$subFont = [System.Drawing.Font]::new("Segoe UI", [single]22, [System.Drawing.FontStyle]::Regular)
$grayBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#9aa0b8"))
$subText = "100% In-Browser  *  No Account  *  DuckDB WASM  *  16 Dialects"
$g.DrawString($subText, $subFont, $grayBrush, [single]90, [single]295)

# Badges
$badges = @("Schema Diff", "Dialect Converter", "DuckDB Scratchpad", "Bulk Validation Queries", "Formatter")
$badgeFont = [System.Drawing.Font]::new("Segoe UI", [single]15, [System.Drawing.FontStyle]::Bold)
$badgeBg = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#1a1e2b"))
$badgeBorder = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#32374c"), [single]1.5)
$badgeTextBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#e2e8f0"))

$bx = 90
foreach ($b in $badges) {
    $size = $g.MeasureString($b, $badgeFont)
    $bw = [int]$size.Width + 28
    $bh = 44
    $g.FillRectangle($badgeBg, $bx, 400, $bw, $bh)
    $g.DrawRectangle($badgeBorder, $bx, 400, $bw, $bh)
    $g.DrawString($b, $badgeFont, $badgeTextBrush, [single]($bx + 14), [single]412)
    $bx += $bw + 16
}

# Footer Domain
$domainFont = [System.Drawing.Font]::new("Consolas", [single]19, [System.Drawing.FontStyle]::Bold)
$mintBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#6fdcae"))
$g.DrawString("https://www.sqlparity.com", $domainFont, $mintBrush, [single]90, [single]520)

$openSourceFont = [System.Drawing.Font]::new("Segoe UI", [single]15, [System.Drawing.FontStyle]::Regular)
$tagline = "No Cookies  *  Nothing Pasted Is Tracked"
$tagSize = $g.MeasureString($tagline, $openSourceFont)
$tagX = [single](1200 - 90 - $tagSize.Width)
$g.DrawString($tagline, $openSourceFont, $grayBrush, $tagX, [single]522)

$bmp.Save("public\og-image.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "Successfully generated public\og-image.png"
