import type { Receipt } from './types';
const item = (id: string, name: string, q: number, unit: number) => ({
  id,
  name,
  quantity: q,
  unitPrice: unit,
  lineTotal: q * unit,
});
const adjustment = (
  id: string,
  label: string,
  kind: 'SERVICE' | 'TAX',
  amount: number,
) => ({ id, label, kind, amount });
export const demos: Receipt[] = [
  {
    restaurantName: 'Little Red House',
    items: [item('i1', 'Chilli crab', 1, 6000), item('i2', 'Mantou', 2, 600)],
    adjustments: [
      adjustment('a1', '10% Service Charge', 'SERVICE', 720),
      adjustment('a2', 'GST 9%', 'TAX', 713),
    ],
    subtotal: 7200,
    subtotalSource: 'DETECTED',
    grandTotal: 8633,
  },
  {
    restaurantName: 'Kopi & Co.',
    items: [item('i1', 'Laksa', 2, 750), item('i2', 'Iced kopi', 2, 220)],
    adjustments: [adjustment('a1', 'GST', 'TAX', 175)],
    subtotal: 1940,
    subtotalSource: 'DETECTED',
    grandTotal: 2115,
  },
  {
    restaurantName: 'Sunny Hawker',
    items: [
      item('i1', 'Chicken rice', 2, 450),
      item('i2', 'Sugarcane juice', 2, 200),
    ],
    adjustments: [],
    subtotal: 1300,
    subtotalSource: 'DETECTED',
    grandTotal: 1300,
  },
];
