/**
 * Linux wallpaper capture.
 *
 * Unlike macOS and Windows there is no single desktop picture file: GNOME keeps
 * a `picture-uri` key, KDE has its own config, and X11 sessions may expose
 * neither. Each source is tried in turn, and a session that exposes none simply
 * reports "unavailable" instead of failing the plugin.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SCALE = 1600;

/** Read the GNOME wallpaper path, the most common modern desktop. */
function gnomeWallpaper() {
  for (const key of ['picture-uri', 'picture-uri-dark']) {
    try {
      const out = execFileSync('gsettings', ['get', 'org.gnome.desktop.background', key], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const value = out.trim().replace(/^'(.*)'$/, '$1').replace(/^file:\/\//, '');
      if (value !== '' && existsSync(decodeURI(value))) return decodeURI(value);
    } catch {}
  }
  return null;
}

/** Read the XFCE wallpaper path from its per-workspace registry. */
function xfceWallpaper() {
  try {
    const out = execFileSync('xfconf-query', ['-c', 'xfce4-desktop', '-l'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n')) {
      if (!line.includes('last-image')) continue;
      try {
        const value = execFileSync('xfconf-query', ['-c', 'xfce4-desktop', '-p', line.trim()], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (value !== '' && existsSync(value)) return value;
      } catch {}
    }
  } catch {}
  return null;
}

/** Copy the source image into the raw slot at a browser-friendly size. */
function convert(sourcePath, rawPath) {
  try {
    execFileSync('magick', [sourcePath, '-resize', `${SCALE}x${SCALE}>`, rawPath], { stdio: 'ignore' });
    return true;
  } catch {}
  try {
    execFileSync('convert', [sourcePath, '-resize', `${SCALE}x${SCALE}>`, rawPath], { stdio: 'ignore' });
    return true;
  } catch {}
  return false;
}

/**
 * Capture the current desktop picture into `rawPath` as PNG.
 * @returns true when a file was written.
 */
export function captureRaw(rawPath) {
  const source = gnomeWallpaper() ?? xfceWallpaper();
  if (source === null) return false;
  return convert(source, rawPath);
}

/** Transcode to the JPEG the browser loads. */
export function toFrameJpeg(rawPath, framePath, edge) {
  for (const [binary, args] of [
    ['magick', [rawPath, '-quality', '70', '-resize', `${edge}x${edge}>`, framePath]],
    ['convert', [rawPath, '-quality', '70', '-resize', `${edge}x${edge}>`, framePath]],
  ]) {
    try {
      execFileSync(binary, args, { stdio: 'ignore' });
      return true;
    } catch {}
  }
  return false;
}

/** Produce the small probe image used for change detection. */
export function toProbe(rawPath, probePath) {
  for (const [binary, args] of [
    ['magick', [rawPath, '-resize', '32x32!', 'BMP3:' + probePath]],
    ['convert', [rawPath, '-resize', '32x32!', 'BMP3:' + probePath]],
  ]) {
    try {
      execFileSync(binary, args, { stdio: 'ignore' });
      return true;
    } catch {}
  }
  return false;
}

/** BMP header size for the 24-bit form ImageMagick writes. */
export const PROBE_HEADER_BYTES = 54;

/** Human-readable backend name, surfaced in the settings page. */
export const backendName = 'Linux desktop wallpaper';
