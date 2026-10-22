/**
 * macOS wallpaper capture.
 *
 * The desktop picture is drawn by a dedicated wallpaper window at layer
 * -2147483624. Capturing that window yields the picture exactly as the desktop
 * shows it — including Apple's dynamic aerial wallpapers, which are video files
 * with no single "current image" on disk.
 *
 * Both shapes of that window are accepted, because Apple moved it:
 *   - macOS ≤ 26: a Dock-owned window named `Wallpaper-<uuid>`
 *   - macOS 27+:  a WindowManager-owned window named exactly `Wallpaper`
 * The owner name is matched in every localized spelling, and the older
 * namesake check keeps working on systems that still report the uuid form.
 *
 * A one-time Swift helper enumerates those windows because CoreGraphics window
 * metadata is only exposed through the native API.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCREENCAPTURE = '/usr/sbin/screencapture';
const SIPS = '/usr/bin/sips';

/**
 * Swift source for the wallpaper-window enumerator, compiled once per process.
 *
 * Prints `id x y width height`, main display first: the window parked at the
 * origin wins, then the largest area. Ordering here keeps `ids[0]` meaning the
 * same thing on single- and multi-display setups.
 */
const LISTWALL_SOURCE = [
  'import CoreGraphics',
  'import Foundation',
  // Dock and WindowManager are localized, so match every owner spelling either
  // generation has used.
  'let owners: Set<String> = ["Dock", "程序坞", "WindowManager"]',
  'let list = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []',
  'var rows: [(Int, Int, Int, Int, Int)] = []',
  'for w in list {',
  '  guard let owner = w["kCGWindowOwnerName"] as? String, owners.contains(owner) else { continue }',
  '  guard let name = w["kCGWindowName"] as? String else { continue }',
  '  let layer = w["kCGWindowLayer"] as? Int ?? 0',
  '  guard layer == -2147483624, name == "Wallpaper" || name.hasPrefix("Wallpaper-") else { continue }',
  '  let id = w["kCGWindowNumber"] as? Int ?? -1',
  '  let b = w["kCGWindowBounds"] as? [String: Any] ?? [:]',
  '  let x = Int(b["X"] as? Double ?? 0)',
  '  let y = Int(b["Y"] as? Double ?? 0)',
  '  let width = Int(b["Width"] as? Double ?? 0)',
  '  let height = Int(b["Height"] as? Double ?? 0)',
  '  guard id > 0, width > 0, height > 0 else { continue }',
  '  rows.append((id, x, y, width, height))',
  '}',
  'rows.sort { a, b in',
  '  let aMain = a.1 == 0 && a.2 == 0',
  '  let bMain = b.1 == 0 && b.2 == 0',
  '  if aMain != bMain { return aMain }',
  '  return a.3 * a.4 > b.3 * b.4',
  '}',
  'for r in rows { print("\\(r.0) \\(r.1) \\(r.2) \\(r.3) \\(r.4)") }',
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

/** Wallpaper window ids, main display first. */
function wallpaperWindowIds() {
  const bin = enumeratorBinary();
  if (bin === false) return [];
  try {
    const out = execFileSync(bin, [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split('\n')
      .map((line) => Number.parseInt(line.trim().split(/\s+/)[0], 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

/**
 * Capture the current desktop picture into `rawPath` as PNG.
 *
 * Tries each wallpaper window in turn: a display can drop its window between
 * enumeration and capture (resolution change, display sleep), and the next
 * candidate still yields a usable picture instead of a blank frame.
 * @returns true when a non-empty file was written.
 */
export function captureRaw(rawPath) {
  const ids = wallpaperWindowIds();
  for (const id of ids) {
    try {
      // Drop any earlier attempt first: a stale file would make a failed
      // capture look like a success on the size check below.
      rmSync(rawPath, { force: true });
      execFileSync(SCREENCAPTURE, ['-x', '-o', '-l', String(id), rawPath], { stdio: 'ignore' });
      if (statSync(rawPath).size > 0) return true;
    } catch {
      // Window vanished or capture refused; fall through to the next one.
    }
  }
  return false;
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

/**
 * Human-readable backend name, surfaced in the status payload.
 *
 * Deliberately owner-neutral: which process draws the desktop picture is an
 * Apple implementation detail that changed once already (Dock → WindowManager),
 * so the label describes what is captured rather than who draws it.
 */
export const backendName = 'macOS wallpaper window';
