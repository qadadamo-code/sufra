import { describe, expect, it } from "vitest";
import { encodeQr, qrPath } from "./qrcode";

// Decoding was verified against OpenCV's QRCodeDetector for versions 1–20 × L/M/Q/H during development;
// these tests pin the structure so a refactor can't silently break printed cards.
describe("QR encoder", () => {
  it("picks the smallest version that fits and draws the fixed patterns", () => {
    const qr = encodeQr("https://sufra.app/app/r/sufra-zamalek/t/ZM05", "M");
    expect(qr.version).toBe(4);
    expect(qr.size).toBe(33);
    const finderAt = (x: number, y: number) => {
      for (let i = 0; i < 7; i++) {
        expect(qr.modules[y][x + i]).toBe(true);
        expect(qr.modules[y + 6][x + i]).toBe(true);
        expect(qr.modules[y + i][x]).toBe(true);
      }
      expect(qr.modules[y + 1][x + 1]).toBe(false);
      expect(qr.modules[y + 3][x + 3]).toBe(true);
    };
    finderAt(0, 0);
    finderAt(qr.size - 7, 0);
    finderAt(0, qr.size - 7);
    for (let i = 8; i < qr.size - 8; i++) expect(qr.modules[6][i]).toBe(i % 2 === 0); // timing
    expect(qr.modules[qr.size - 8][8]).toBe(true); // dark module
  });

  it("is deterministic and grows with data / ECC", () => {
    const a = encodeQr("hello", "L");
    expect(encodeQr("hello", "L").modules).toEqual(a.modules);
    expect(encodeQr("x".repeat(300), "H").version).toBeGreaterThan(encodeQr("x".repeat(300), "L").version);
    expect(() => encodeQr("x".repeat(4000), "H")).toThrow();
  });

  it("renders a single SVG path with one sub-path per dark run", () => {
    const qr = encodeQr("ZM05", "Q");
    const d = qrPath(qr);
    expect(d.startsWith("M")).toBe(true);
    const dark = qr.modules.flat().filter(Boolean).length;
    const widths = [...d.matchAll(/h(\d+)v1/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(widths).toBe(dark);
  });
});
