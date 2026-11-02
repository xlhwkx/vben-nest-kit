import { Injectable } from '@nestjs/common';

export type DemoTableRow = {
  id: string;
  imageUrl: string;
  imageUrl2: string;
  open: boolean;
  status: 'success' | 'error' | 'warning';
  productName: string;
  price: string;
  currency: string;
  quantity: number;
  available: boolean;
  category: string;
  releaseDate: string;
  rating: number;
  description: string;
  weight: number;
  color: string;
  inProduction: boolean;
  tags: string[];
};

const STATUS_CYCLE: Array<DemoTableRow['status']> = [
  'success',
  'error',
  'warning',
];
const CATEGORIES = [
  'Electronics',
  'Home',
  'Sports',
  'Books',
  'Garden',
  'Toys',
];
const COLORS = ['red', 'blue', 'green', 'black', 'white', 'yellow'];
const CURRENCIES = ['USD', 'EUR', 'CNY', 'JPY'];
const ADJECTIVES = ['Fresh', 'Awesome', 'Sleek', 'Rustic', 'Modern', 'Classic'];

function pad12(n: number): string {
  return String(n).padStart(12, '0');
}

function buildDataset(count = 100): DemoTableRow[] {
  const rows: DemoTableRow[] = [];
  for (let i = 1; i <= count; i++) {
    rows.push({
      id: `00000000-0000-7000-8000-${pad12(i)}`,
      imageUrl: `https://i.pravatar.cc/150?u=qz-table-${i}`,
      imageUrl2: `https://i.pravatar.cc/150?u=qz-table-b-${i}`,
      open: i % 2 === 0,
      status: STATUS_CYCLE[(i - 1) % STATUS_CYCLE.length]!,
      productName: `Product ${i}`,
      price: (10 + (i % 90) + i / 100).toFixed(2),
      currency: CURRENCIES[(i - 1) % CURRENCIES.length]!,
      quantity: ((i * 7) % 100) + 1,
      available: i % 3 !== 0,
      category: CATEGORIES[(i - 1) % CATEGORIES.length]!,
      releaseDate: new Date(Date.UTC(2024, (i - 1) % 12, ((i - 1) % 28) + 1)).toISOString(),
      rating: Number((1 + ((i * 13) % 40) / 10).toFixed(1)),
      description: `Demo row ${i} for Vben table list`,
      weight: Number((0.1 + ((i * 3) % 99) / 10).toFixed(1)),
      color: COLORS[(i - 1) % COLORS.length]!,
      inProduction: i % 4 !== 0,
      tags: [
        ADJECTIVES[i % ADJECTIVES.length]!,
        ADJECTIVES[(i + 2) % ADJECTIVES.length]!,
        ADJECTIVES[(i + 4) % ADJECTIVES.length]!,
      ],
    });
  }
  return rows;
}

const DATASET = buildDataset(100);

function parsePositiveInt(
  v: string | undefined,
  fallback: number,
  max?: number,
): number {
  const n = Number.parseInt(String(v ?? fallback), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  if (max !== undefined && n > max) return max;
  return n;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    if (a === b) return 0;
    return a ? 1 : -1;
  }
  const aStr = String(a);
  const bStr = String(b);
  const aNum = Number(aStr);
  const bNum = Number(bStr);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return aStr.localeCompare(bStr, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

@Injectable()
export class TableService {
  list(query: {
    page?: string;
    pageSize?: string;
    sortBy?: string;
    sortOrder?: string;
  }): { items: DemoTableRow[]; total: number } {
    const page = parsePositiveInt(query.page, 1);
    const pageSize = parsePositiveInt(query.pageSize, 10, 100);
    const listData = DATASET.map((row) => ({ ...row, tags: [...row.tags] }));

    const sortKey = query.sortBy?.trim();
    if (
      sortKey &&
      listData[0] &&
      Object.prototype.hasOwnProperty.call(listData[0], sortKey)
    ) {
      const isDesc = query.sortOrder === 'desc';
      const key = sortKey as keyof DemoTableRow;
      listData.sort((a, b) => {
        const result = compareValues(a[key], b[key]);
        return isDesc ? -result : result;
      });
    }

    const start = (page - 1) * pageSize;
    const items = listData.slice(start, start + pageSize);
    return { items, total: DATASET.length };
  }
}
