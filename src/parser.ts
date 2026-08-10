import { demos } from './demos';
import type { Receipt } from './types';
export interface ReceiptParser {
  parse(image: Blob): Promise<Receipt>;
}
export class DemoReceiptParser implements ReceiptParser {
  async parse() {
    return structuredClone(demos[0]);
  }
}
