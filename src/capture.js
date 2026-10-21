/**
 * Platform backend selection.
 *
 * Every backend exposes the same four members, so the capture loop never
 * branches on the operating system:
 *   captureRaw(rawPath)                  → write the desktop picture as PNG
 *   toFrameJpeg(rawPath, frame, edge)    → transcode to the browser's JPEG
 *   toProbe(rawPath, probePath)          → small image for change detection
 *   backendName                          → label shown in the settings page
 *
 * An unsupported platform resolves to `null`; the plugin then reports that
 * capture is unavailable instead of throwing during activation.
 */

/**
 * Resolve the backend for a platform string.
 * @param platform - `process.platform` value.
 * @returns the backend module, or null when the platform has none.
 */
export async function backendFor(platform) {
  switch (platform) {
    case 'darwin':
      return import('./backends/macos.js');
    case 'win32':
      return import('./backends/windows.js');
    case 'linux':
      return import('./backends/linux.js');
    default:
      return null;
  }
}
