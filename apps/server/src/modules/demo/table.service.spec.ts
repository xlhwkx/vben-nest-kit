import { TableService } from './table.service';

describe('TableService', () => {
  const service = new TableService();

  it('returns paginated items + total (default pageSize 10)', () => {
    const page1 = service.list({});
    expect(page1.total).toBe(100);
    expect(page1.items).toHaveLength(10);
    expect(page1.items[0]?.id).toBe('00000000-0000-7000-8000-000000000001');

    const page2 = service.list({ page: '2', pageSize: '10' });
    expect(page2.items[0]?.id).toBe('00000000-0000-7000-8000-000000000011');
  });

  it('sorts by quantity desc', () => {
    const res = service.list({
      page: '1',
      pageSize: '5',
      sortBy: 'quantity',
      sortOrder: 'desc',
    });
    const qty = res.items.map((r) => r.quantity);
    const sorted = [...qty].sort((a, b) => b - a);
    expect(qty).toEqual(sorted);
  });

  it('caps pageSize at 100', () => {
    const res = service.list({ page: '1', pageSize: '999' });
    expect(res.items).toHaveLength(100);
  });
});
