import type { ParseProgress, ReceiptParser } from './parser';
import { parseReceiptText } from './parser';
import { createWorker } from 'tesseract.js';

async function preprocess(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image, {
    imageOrientation: 'from-image',
  });
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context)
    throw new Error('This browser cannot prepare the receipt image.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const grey =
      0.299 * pixels.data[i] +
      0.587 * pixels.data[i + 1] +
      0.114 * pixels.data[i + 2];
    const contrast = Math.max(0, Math.min(255, (grey - 128) * 1.25 + 128));
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = contrast;
  }
  context.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Could not prepare image.')),
      'image/jpeg',
      0.9,
    ),
  );
}

export class LocalOcrReceiptParser implements ReceiptParser {
  async parse(image: Blob, onProgress?: (update: ParseProgress) => void) {
    onProgress?.({ stage: 'preparing', progress: 0 });
    const prepared = await preprocess(image);
    onProgress?.({ stage: 'reading', progress: 0 });
    const worker = await createWorker('eng', 1, {
      logger(message) {
        if (message.status === 'recognizing text')
          onProgress?.({ stage: 'reading', progress: message.progress });
      },
    });
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Reading timed out. Please retry with a clearer, closely cropped photo.',
              ),
            ),
          120_000,
        ),
      );
      const result = await Promise.race([worker.recognize(prepared), timeout]);
      onProgress?.({ stage: 'understanding', progress: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const receipt = parseReceiptText(result.data.text);
      onProgress?.({ stage: 'checking', progress: 1 });
      return receipt;
    } finally {
      await worker.terminate();
    }
  }
}
