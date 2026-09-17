// Native (Capacitor) photo capture for the Identifier flow.
//
// Only imported/called from native platforms (see isNativePlatform() in
// lib/platform.js) — normal web keeps using the hidden <input type="file">
// untouched. @capacitor/camera's web fallback is pure JS with no native
// permission prompts, so importing this module at the top of a page is
// always safe; it is simply never invoked there.
//
// @capacitor/camera 8.x deprecated the old getPhoto()/CameraSource.Prompt
// combo (which used to show a single native "camera or library" sheet) in
// favor of two separate calls, takePhoto() and chooseFromGallery() — the
// deprecation notice says to build your own source picker, which is what
// the caller (IdentifierTab's NativePhotoSourceSheet) does.
import { Camera, CameraErrorCode } from "@capacitor/camera";

const CANCELLED_CODES = new Set([
  CameraErrorCode.TakePhotoCancelled,
  CameraErrorCode.ChooseMediaCancelled,
]);

const DENIED_CODES = new Set([
  CameraErrorCode.CameraPermissionDenied,
  CameraErrorCode.GalleryPermissionDenied,
]);

// takePhoto/chooseFromGallery reject with a structured `code` (matching
// CameraErrorCode) on the modern native flow, but the web shim and a couple
// of native edge cases still only reject with a plain message string — so
// code is checked first and the message is a fallback, not a replacement.
export function classifyCameraError(error) {
  const code = error && error.code;
  if (code && CANCELLED_CODES.has(code)) return "cancelled";
  if (code && DENIED_CODES.has(code)) return "denied";
  const message = (error && error.message) || "";
  if (/cancel/i.test(message)) return "cancelled";
  if (/denied/i.test(message)) return "denied";
  return "error";
}

// Bridges a Capacitor MediaResult into the same File type the existing
// hidden file-input hands to handleFile()/resizeImage(), so nothing
// downstream (preview, resize/compression, analysis) needs to know whether
// the photo came from the web file picker or the native Camera plugin.
export async function mediaResultToFile(result) {
  const rawFormat = (result.metadata && result.metadata.format) || "jpeg";
  const format = rawFormat === "jpg" ? "jpeg" : rawFormat;
  const source = result.webPath || result.uri;
  const response = await fetch(source);
  const blob = await response.blob();
  return new File([blob], `photo.${format}`, { type: blob.type || `image/${format}` });
}

// source: "camera" | "gallery". Returns:
//   { status: "ok", file: File }
//   { status: "cancelled" }   — user backed out; caller must not show an error
//   { status: "denied" }      — camera/photos permission denied
//   { status: "error" }       — anything else (device/plugin failure)
export async function captureNativePhoto(source) {
  try {
    let result;
    if (source === "camera") {
      result = await Camera.takePhoto({ quality: 90 });
    } else {
      const { results } = await Camera.chooseFromGallery({ quality: 90 });
      result = results && results[0];
      if (!result) return { status: "cancelled" };
    }
    const file = await mediaResultToFile(result);
    return { status: "ok", file };
  } catch (error) {
    return { status: classifyCameraError(error) };
  }
}
