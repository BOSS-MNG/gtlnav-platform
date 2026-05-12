Add-Type -AssemblyName System.Drawing

# Inline C# helper avoids PowerShell's flaky overload resolution
# for Graphics.DrawImage(Image, Rectangle, Rectangle, GraphicsUnit).
Add-Type -ReferencedAssemblies "System.Drawing" -TypeDefinition @"
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class FaviconHelper
{
    public static Bitmap RenderSquare(Image src, int size, int? cropX, int? cropY, int? cropSize)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.InterpolationMode  = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode      = SmoothingMode.AntiAlias;
            g.PixelOffsetMode    = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.Clear(Color.Transparent);

            var dst = new Rectangle(0, 0, size, size);
            if (cropX.HasValue && cropY.HasValue && cropSize.HasValue)
            {
                var srcRect = new Rectangle(cropX.Value, cropY.Value, cropSize.Value, cropSize.Value);
                g.DrawImage(src, dst, srcRect, GraphicsUnit.Pixel);
            }
            else
            {
                g.DrawImage(src, dst);
            }
        }
        return bmp;
    }
}
"@

$root      = Resolve-Path (Join-Path $PSScriptRoot "..")
$srcPath   = Join-Path $root "public\branding\gtlnav-logo.png"
$brandDir  = Join-Path $root "public\branding"
$publicDir = Join-Path $root "public"

if (-not (Test-Path -LiteralPath $srcPath)) {
    throw "Source logo not found at $srcPath"
}

$src = [System.Drawing.Image]::FromFile($srcPath)

# Tight central crop isolates the leaf cluster for small sizes so the
# orbital arc + sparkle particles don't dilute the mark at 16x16 / 32x32.
$cropSize = 210
$cx = [int](($src.Width  - $cropSize) / 2)
$cy = [int](($src.Height - $cropSize) / 2)

$bmp16  = [FaviconHelper]::RenderSquare($src, 16,  $cx, $cy, $cropSize)
$bmp32  = [FaviconHelper]::RenderSquare($src, 32,  $cx, $cy, $cropSize)
$bmp48  = [FaviconHelper]::RenderSquare($src, 48,  $cx, $cy, $cropSize)
$bmp180 = [FaviconHelper]::RenderSquare($src, 180, $null, $null, $null)

$out16  = Join-Path $brandDir "favicon-16x16.png"
$out32  = Join-Path $brandDir "favicon-32x32.png"
$out180 = Join-Path $brandDir "apple-touch-icon.png"

$bmp16.Save($out16,   [System.Drawing.Imaging.ImageFormat]::Png)
$bmp32.Save($out32,   [System.Drawing.Imaging.ImageFormat]::Png)
$bmp180.Save($out180, [System.Drawing.Imaging.ImageFormat]::Png)

# Build a multi-size favicon.ico that embeds 16x16, 32x32, 48x48 PNG entries.
function Save-Png-To-Bytes {
    param([System.Drawing.Bitmap]$Bitmap)
    $ms = New-Object System.IO.MemoryStream
    $Bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return ,$bytes
}

$entries = @(
    @{ size = 16; bytes = (Save-Png-To-Bytes -Bitmap $bmp16) },
    @{ size = 32; bytes = (Save-Png-To-Bytes -Bitmap $bmp32) },
    @{ size = 48; bytes = (Save-Png-To-Bytes -Bitmap $bmp48) }
)

$icoStream = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $icoStream
$bw.Write([UInt16]0)               # reserved
$bw.Write([UInt16]1)               # type: 1 = icon
$bw.Write([UInt16]$entries.Count)  # count

$dataOffset = 6 + (16 * $entries.Count)
foreach ($e in $entries) {
    $sz = $e.size
    $w = if ($sz -ge 256) { 0 } else { $sz }
    $h = $w
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)              # color palette count
    $bw.Write([byte]0)              # reserved
    $bw.Write([UInt16]1)            # color planes
    $bw.Write([UInt16]32)           # bits per pixel
    $bw.Write([UInt32]$e.bytes.Length)
    $bw.Write([UInt32]$dataOffset)
    $dataOffset += $e.bytes.Length
}
foreach ($e in $entries) {
    $bw.Write($e.bytes)
}
$bw.Flush()

$icoPath = Join-Path $publicDir "favicon.ico"
[System.IO.File]::WriteAllBytes($icoPath, $icoStream.ToArray())

$bw.Dispose()
$icoStream.Dispose()
$bmp16.Dispose()
$bmp32.Dispose()
$bmp48.Dispose()
$bmp180.Dispose()
$src.Dispose()

Write-Host "Generated:"
Write-Host ("  {0,-46}  {1,6} bytes" -f $out16,  (Get-Item $out16).Length)
Write-Host ("  {0,-46}  {1,6} bytes" -f $out32,  (Get-Item $out32).Length)
Write-Host ("  {0,-46}  {1,6} bytes" -f $out180, (Get-Item $out180).Length)
Write-Host ("  {0,-46}  {1,6} bytes" -f $icoPath,(Get-Item $icoPath).Length)
