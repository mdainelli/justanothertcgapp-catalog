import { describe, expect, it } from "vitest";
import { checkJpeg } from "../src/jpeg";
import { app1, jpeg } from "./helpers";

describe("checkJpeg", () => {
  it("accepts a clean JPEG (with JFIF APP0)", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array.from("JFIF\0", (c) => c.charCodeAt(0)), 1, 1, 0, 0, 1, 0, 1, 0, 0];
    expect(checkJpeg(jpeg(app0))).toEqual({ ok: true });
    expect(checkJpeg(jpeg())).toEqual({ ok: true });
  });
  it("rejects Exif APP1", () => {
    const r = checkJpeg(jpeg(app1("Exif\0\0MM\0*")));
    expect(r).toMatchObject({ ok: false, code: "invalid_image_metadata" });
  });
  it("rejects XMP APP1", () => {
    const r = checkJpeg(jpeg(app1("http://ns.adobe.com/xap/1.0/\0<x/>")));
    expect(r).toMatchObject({ ok: false, code: "invalid_image_metadata", reason: "XMP segment present" });
  });
  it("rejects APP1 after other segments and fill bytes", () => {
    const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x01];
    expect(checkJpeg(jpeg(dqt, [0xff, 0xff], app1("Exif\0\0")))).toMatchObject({ code: "invalid_image_metadata" });
  });
  it("rejects non-JPEG and truncated data", () => {
    expect(checkJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ code: "invalid_image" });
    expect(checkJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x50]))).toMatchObject({ code: "invalid_image" });
    expect(checkJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toMatchObject({ code: "invalid_image" });
    expect(checkJpeg(new Uint8Array([]))).toMatchObject({ code: "invalid_image" });
  });
});
