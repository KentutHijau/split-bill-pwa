import { createWorker, OEM, PSM } from 'tesseract.js';
import type { ParseProgress, ReceiptParser } from './parser';
import { parseReceiptText } from './parser';
import type { OcrDiagnostics, Receipt } from './types';

export const OCR_MAX_LONG_EDGE = 2400;
export const PREPROCESSING_VERSION = 'makan-ocr-v2';
export const OCR_LANGUAGE = 'eng';
export const TESSERACT_VERSION = '6.0.1';
export const OCR_PSM = '6 (single uniform block)';

export interface Dimensions { width: number; height: number }

/** Long edge is capped; the other edge is Math.round(source * scale). */
export function calculateOcrDimensions(
  width: number,
  height: number,
  maximum = OCR_MAX_LONG_EDGE,
): Dimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || maximum < 1)
    throw new Error('Invalid image dimensions.');
  const scale = Math.min(1, maximum / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function orientationName(orientation: number): string {
  return ({ 1: 'none', 2: 'mirror horizontal', 3: 'rotate 180°', 4: 'mirror vertical',
    5: 'transpose', 6: 'rotate 90° clockwise', 7: 'transverse', 8: 'rotate 90° counter-clockwise' } as Record<number, string>)[orientation] ?? 'none';
}

export function orientedDimensions(width: number, height: number, orientation: number): Dimensions {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

/** Reads JPEG EXIF orientation without asking the browser to interpret it. */
export function readExifOrientation(bytes: ArrayBuffer): number {
  const view = new DataView(bytes);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset); offset += 2;
    if ((marker & 0xff00) !== 0xff00) break;
    const length = view.getUint16(offset); offset += 2;
    if (length < 2 || offset + length - 2 > view.byteLength) break;
    if (marker === 0xffe1 && length >= 10 && view.getUint32(offset) === 0x45786966) {
      const tiff = offset + 6;
      const little = view.getUint16(tiff) === 0x4949;
      const get16 = (at: number) => view.getUint16(at, little);
      const get32 = (at: number) => view.getUint32(at, little);
      const ifd = tiff + get32(tiff + 4);
      if (ifd + 2 > view.byteLength) return 1;
      const count = get16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) break;
        if (get16(entry) === 0x0112) {
          const value = get16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
    }
    offset += length - 2;
  }
  return 1;
}

export function fingerprintPayload(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const payload = new Uint8Array(8 + rgba.length);
  const view = new DataView(payload.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  payload.set(rgba, 8);
  return payload;
}

export async function sha256Hex(payload: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', payload);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function applyOrientation(context: CanvasRenderingContext2D, orientation: number, width: number, height: number) {
  // Matrix maps raw source coordinates into an orientation-normalized canvas.
  const matrices: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, width, 0], 3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height], 5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0], 7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  if (matrices[orientation]) context.transform(...matrices[orientation]);
}

async function preprocess(image: Blob): Promise<{ blob: Blob; diagnostics: OcrDiagnostics }> {
  const sourceBytes = await image.arrayBuffer();
  const orientation = readExifOrientation(sourceBytes);
  // `none` prevents createImageBitmap from silently applying EXIF before our explicit transform.
  const bitmap = await createImageBitmap(image, { imageOrientation: 'none' });
  const raw = { width: bitmap.width, height: bitmap.height };
  const oriented = orientedDimensions(raw.width, raw.height, orientation);
  const output = calculateOcrDimensions(oriented.width, oriented.height);
  const canvas = document.createElement('canvas');
  canvas.width = output.width; canvas.height = output.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { bitmap.close(); throw new Error('This browser cannot prepare the receipt image.'); }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const scaleX = output.width / oriented.width;
  const scaleY = output.height / oriented.height;
  context.scale(scaleX, scaleY);
  applyOrientation(context, orientation, raw.width, raw.height);
  context.drawImage(bitmap, 0, 0, raw.width, raw.height);
  bitmap.close();
  context.setTransform(1, 0, 0, 1, 0, 0);
  const pixels = context.getImageData(0, 0, output.width, output.height);
  // Integer BT.601 grayscale followed by fixed 5/4 contrast; alpha is preserved.
  for (let i = 0; i < pixels.data.length; i += 4) {
    const grey = (77 * pixels.data[i] + 150 * pixels.data[i + 1] + 29 * pixels.data[i + 2] + 128) >> 8;
    const contrast = Math.max(0, Math.min(255, Math.round((grey - 128) * 5 / 4 + 128)));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = contrast;
  }
  context.putImageData(pixels, 0, 0);
  let fingerprint = 'unavailable';
  try { fingerprint = await sha256Hex(fingerprintPayload(output.width, output.height, pixels.data)); } catch { /* diagnostics must not abort OCR */ }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('Could not prepare image.')), 'image/png'));
  const file = image instanceof File ? image : undefined;
  return { blob, diagnostics: {
    sourceFileName: file?.name ?? '(blob)', sourceMimeType: image.type || '(unknown)', sourceFileSize: image.size,
    originalWidth: raw.width, originalHeight: raw.height, exifOrientation: orientation,
    orientationTransform: orientationName(orientation), normalizedWidth: output.width, normalizedHeight: output.height,
    maximumDimension: OCR_MAX_LONG_EDGE, preprocessingVersion: PREPROCESSING_VERSION,
    ocrLanguage: OCR_LANGUAGE, tesseractVersion: TESSERACT_VERSION, engineMode: 'OEM 1 (LSTM only)',
    pageSegmentationMode: OCR_PSM, userAgent: navigator.userAgent, rawOcrCharacterCount: 0, fingerprint,
  }};
}

export class LocalOcrReceiptParser implements ReceiptParser {
  async parse(image: Blob, onProgress?: (update: ParseProgress) => void): Promise<Receipt> {
    onProgress?.({ stage: 'preparing', progress: 0 });
    const prepared = await preprocess(image);
    onProgress?.({ stage: 'reading', progress: 0 });
    const worker = await createWorker(OCR_LANGUAGE, OEM.LSTM_ONLY, { logger(message) {
      if (message.status === 'recognizing text') onProgress?.({ stage: 'reading', progress: message.progress });
    }});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(
        'Reading timed out. Please retry with a clearer, closely cropped photo.')), 120_000); });
      const result = await Promise.race([worker.recognize(prepared.blob), timeout]);
      onProgress?.({ stage: 'understanding', progress: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const receipt = parseReceiptText(result.data.text);
      prepared.diagnostics.rawOcrCharacterCount = result.data.text.length;
      receipt.ocrDiagnostics = prepared.diagnostics;
      receipt.ocrInputImage = prepared.blob;
      onProgress?.({ stage: 'checking', progress: 1 });
      return receipt;
    } finally {
      if (timer) clearTimeout(timer);
      await worker.terminate();
    }
  }
}
