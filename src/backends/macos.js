/**
 * macOS wallpaper capture.
 *
 * The desktop picture is drawn by a Dock-owned window named `Wallpaper-<uuid>`
 * (layer -2147483624). Capturing that window yields the picture exactly as the
 * desktop shows it — including Apple's dynamic aerial wallpapers, which are
 * video files with no single "current image" on disk.
 *
 * A one-time Swift helper enumerates those windows because CoreGraphics window
 * metadata is only exposed through the native API.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCREENCAPTURE = '/usr/sbin/screencapture';
const SIPS = '/usr/bin/sips';

/** Swift source for the wallpaper-window enumerator, compiled once per process. */
const LISTWALL_SOURCE = [
  'import CoreGraphics',
  'import Foundation',
  // Dock is localized, so match both the English and Chinese owner names.
  'let owners: Set<String> = ["Dock", "程序坞"]',
  'let list = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []',
  'var out: [String] = []',
  'for w in list {',
  '  guard let owner = w["kCGWindowOwnerName"] as? String, owners.contains(owner) else { continue }',
  '  guard let name = w["kCGWindowName"] as? String else { continue }',
  '  let layer = w["kCGWindowLayer"] as? Int ?? 0',
  '  guard layer == -2147483624, name.hasPrefix("Wallpaper-"), name.count > 10,',
  '        name[name.index(name.startIndex, offsetBy: 10)].isHexDigit else { continue }',
  '  out.append("\\(w["kCGWindowNumber"] as? Int ?? -1)")',
  '}',
  'print(out.joined(separator: "\\n"))',
].join('\n');

let enumerator = null;

/** Compile the window enumerator once; returns its path, or null when unavailable. */
function enumeratorBinary() {
  if (enumerator !== null) return enumerator;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-wallpaper-swift-'));
    const src = join(dir, 'listwall.swift');
    const bin = join(dir, 'listwall');
    writeFileSync(src, LISTWALL_SOURCE);
    execFileSync('swiftc', ['-O', src, '-o', bin], { stdio: 'pipe' });
    enumerator = bin;
    return bin;
  } catch {
    enumerator = false;
    return false;
  }
}

/** Wallpaper window ids, lowest (main display) first. */
function wallpaperWindowIds() {
  const bin = enumeratorBinary();
  if (bin === false) return [];
  try {
    const out = execFileSync(bin, [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split('\n')
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

/**
 * Capture the current desktop picture into `rawPath` as PNG.
 * @returns true when a file was written.
 */
export function captureRaw(rawPath) {
  const ids = wallpaperWindowIds();
  if (ids.length === 0) return false;
  try {
    execFileSync(SCREENCAPTURE, ['-x', '-o', '-l', String(ids[0]), rawPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Downscale one image to a JPEG for the browser.
 * @returns true when the JPEG was written.
 */
export function toFrameJpeg(rawPath, framePath, edge) {
  try {
    execFileSync(
      SIPS,
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', String(edge), rawPath, '--out', framePath],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Downscale one image to a small BMP used as a change probe.
 * @returns true when the probe was written.
 */
export function toProbe(rawPath, probePath) {
  try {
    execFileSync(SIPS, ['-z', '32', '32', '-s', 'format', 'bmp', rawPath, '--out', probePath], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/** BMP header size for the 24/32-bit forms `sips` writes. */
export const PROBE_HEADER_BYTES = 54;

/** Human-readable backend name, surfaced in the settings page. */
export const backendName = 'macOS Dock wallpaper window';
