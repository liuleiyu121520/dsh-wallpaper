/**
 * Windows wallpaper capture.
 *
 * Windows keeps the desktop picture in the registry as a file path
 * (`HKCU\Control Panel\Desktop\Wallpaper`). That path is the authoritative
 * source: it also covers slideshow rotation, since the value follows the
 * picture currently displayed.
 *
 * Slideshow/spotlight wallpapers can occasionally point at a transient file, so
 * a failed read falls back to sampling the desktop itself with .NET.
 */
import { execFileSync } from 'node:child_process';

const POWERSHELL = 'powershell.exe';

/** Read the configured wallpaper path from the current user's registry hive. */
function registryWallpaperPath() {
  try {
    const out = execFileSync(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper -ErrorAction Stop).Wallpaper",
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    const value = out.trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

/**
 * Sample the desktop through .NET, which composites every wallpaper style
 * (fill, fit, span) exactly as the user sees it.
 */
function sampleDesktop(outputPath) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)',
    '$bmp.Save(\'' + outputPath.replace(/'/g, "''") + '\', [System.Drawing.Imaging.ImageFormat]::Png)',
    '$g.Dispose()',
    '$bmp.Dispose()',
  ].join('; ');
  try {
    execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Copy the wallpaper file to the raw slot, downscaling when .NET is available. */
function copyWallpaper(sourcePath, rawPath) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    '$src = [System.Drawing.Image]::FromFile(\'' + sourcePath.replace(/'/g, "''") + '\')',
    '$w = 1600',
    '$ratio = $w / $src.Width',
    '$h = [int]($src.Height * $ratio)',
    '$dst = New-Object System.Drawing.Bitmap $w, $h',
    '$g = [System.Drawing.Graphics]::FromImage($dst)',
    "$g.InterpolationMode = 'HighQualityBicubic'",
    '$g.DrawImage($src, 0, 0, $w, $h)',
    '$dst.Save(\'' + rawPath.replace(/'/g, "''") + '\', [System.Drawing.Imaging.ImageFormat]::Png)',
    '$g.Dispose(); $dst.Dispose(); $src.Dispose()',
  ].join('; ');
  try {
    execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the current desktop picture into `rawPath` as PNG.
 * @returns true when a file was written.
 */
export function captureRaw(rawPath) {
  const source = registryWallpaperPath();
  if (source !== null && copyWallpaper(source, rawPath)) return true;
  return sampleDesktop(rawPath);
}

/**
 * Windows already writes a PNG; the shared pipeline still expects a helper that
 * produces the JPEG the browser loads. .NET performs the transcode.
 * @returns true when the JPEG was written.
 */
export function toFrameJpeg(rawPath, framePath, edge) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    '$src = [System.Drawing.Image]::FromFile(\'' + rawPath.replace(/'/g, "''") + '\')',
    '$w = [Math]::Min(' + String(edge) + ', $src.Width)',
    '$h = [int]($src.Height * ($w / $src.Width))',
    '$dst = New-Object System.Drawing.Bitmap $w, $h',
    '$g = [System.Drawing.Graphics]::FromImage($dst)',
    "$g.InterpolationMode = 'HighQualityBicubic'",
    '$g.DrawImage($src, 0, 0, $w, $h)',
    "$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
    '$p = New-Object System.Drawing.Imaging.EncoderParameters 1',
    '$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, 70)',
    '$dst.Save(\'' + framePath.replace(/'/g, "''") + '\', $codec, $p)',
    '$g.Dispose(); $dst.Dispose(); $src.Dispose()',
  ].join('; ');
  try {
    execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Produce the small probe image used for change detection.
 * Windows writes a BMP so the shared pixel-comparison code reads the same
 * header layout; .NET emits 32bpp BMP here.
 * @returns true when the probe was written.
 */
export function toProbe(rawPath, probePath) {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    '$src = [System.Drawing.Image]::FromFile(\'' + rawPath.replace(/'/g, "''") + '\')',
    '$dst = New-Object System.Drawing.Bitmap 32, 32',
    '$g = [System.Drawing.Graphics]::FromImage($dst)',
    "$g.InterpolationMode = 'HighQualityBicubic'",
    '$g.DrawImage($src, 0, 0, 32, 32)',
    '$dst.Save(\'' + probePath.replace(/'/g, "''") + '\', [System.Drawing.Imaging.ImageFormat]::Bmp)',
    '$g.Dispose(); $dst.Dispose(); $src.Dispose()',
  ].join('; ');
  try {
    execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** BMP header size for the 24/32-bit forms .NET writes. */
export const PROBE_HEADER_BYTES = 54;

/** Human-readable backend name, surfaced in the settings page. */
export const backendName = 'Windows desktop wallpaper';
