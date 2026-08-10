import { describe, expect, it } from 'vitest';
import {
  calculateOcrDimensions,
  fingerprintPayload,
  orientedDimensions,
  orientationName,
  readExifOrientation,
  sha256Hex,
} from './ocr';

describe('deterministic OCR preprocessing calculations', () => {
  it('caps the long edge and uses Math.round for the short edge', () => {
    expect(calculateOcrDimensions(4032, 3024)).toEqual({ width: 2400, height: 1800 });
    expect(calculateOcrDimensions(1001, 3000)).toEqual({ width: 801, height: 2400 });
    expect(calculateOcrDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('swaps dimensions only for quarter-turn EXIF orientations', () => {
    for (const orientation of [1, 2, 3, 4])
      expect(orientedDimensions(1200, 800, orientation)).toEqual({ width: 1200, height: 800 });
    for (const orientation of [5, 6, 7, 8])
      expect(orientedDimensions(1200, 800, orientation)).toEqual({ width: 800, height: 1200 });
    expect(orientationName(6)).toBe('rotate 90° clockwise');
  });

  it('defaults non-JPEG input to orientation 1', () => {
    expect(readExifOrientation(new Uint8Array([1, 2, 3, 4]).buffer)).toBe(1);
  });

  it('hashes dimensions and RGBA bytes deterministically', async () => {
    const first = fingerprintPayload(1, 1, new Uint8ClampedArray([1, 2, 3, 255]));
    const second = fingerprintPayload(1, 1, new Uint8ClampedArray([1, 2, 3, 255]));
    expect(first).toEqual(second);
    expect(await sha256Hex(first)).toBe(await sha256Hex(second));
    expect(await sha256Hex(fingerprintPayload(2, 1, new Uint8ClampedArray([1, 2, 3, 255])))).not.toBe(await sha256Hex(first));
  });
});
