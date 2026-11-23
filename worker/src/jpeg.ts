export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type JpegCheck =
  | { ok: true }
  | { ok: false; code: "invalid_image" | "invalid_image_metadata"; reason: string };

const ascii = (b: Uint8Array, start: number, len: number): string =>
  String.fromCharCode(...b.subarray(start, start + len));

/**
 * Walks the JPEG marker segments up to the start of scan (SOS) and rejects
 * files that carry an APP1 segment (Exif or XMP; any APP1 is refused).
 */
export function checkJpeg(b: Uint8Array): JpegCheck {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) {
    return { ok: false, code: "invalid_image", reason: "not a JPEG (missing FF D8)" };
  }
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return { ok: false, code: "invalid_image", reason: "corrupt JPEG segment" };
    while (b[i] === 0xff) i++; // fill bytes
    const marker = b[i];
    if (marker === undefined) break;
    i++;
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // no length
    if (i + 2 > b.length) return { ok: false, code: "invalid_image", reason: "truncated JPEG" };
    const len = (b[i]! << 8) | b[i + 1]!;
    if (len < 2 || i + len > b.length) return { ok: false, code: "invalid_image", reason: "invalid segment length" };
    if (marker === 0xe1) {
      const head = ascii(b, i + 2, Math.min(29, len - 2));
      const kind = head.startsWith("Exif") ? "Exif" : head.startsWith("http://ns.adobe.com/xap/") ? "XMP" : "APP1";
      return { ok: false, code: "invalid_image_metadata", reason: `${kind} segment present` };
    }
    if (marker === 0xda) return { ok: true }; // SOS: image data follows
    i += len;
  }
  // Reached EOI/end without SOS: not a decodable image.
  return { ok: false, code: "invalid_image", reason: "no image data" };
}
