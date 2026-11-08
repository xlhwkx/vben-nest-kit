import type { Prisma } from '../../generated/prisma/client';

/** System configuration used by the admin UI, independent of demo accounts. */
export const SYSTEM_DICTIONARIES = [
  {
    code: 'user_gender',
    name: '用户性别',
    remark: '用户性别字典',
    items: [
      { label: '男', value: 1, sort: 1 },
      { label: '女', value: 0, sort: 2 },
      { label: '未知', value: 2, sort: 3 },
    ],
  },
  {
    code: 'common_status',
    name: '通用状态',
    remark: '启用/禁用',
    items: [
      { label: '启用', value: 1, color: 'success', sort: 1 },
      { label: '禁用', value: 0, color: 'error', sort: 2 },
    ],
  },
  {
    code: 'yes_no',
    name: '是否',
    remark: '是否选项',
    items: [
      { label: '是', value: 1, sort: 1 },
      { label: '否', value: 0, sort: 2 },
    ],
  },
] as const;

/**
 * Caller holds the system-management advisory lock in the same transaction.
 * Existing types, including disabled/customized/empty types, are never changed.
 */
export async function provisionSystemDictionaries(tx: Prisma.TransactionClient) {
  const created: string[] = [];
  const preserved: string[] = [];
  for (const spec of SYSTEM_DICTIONARIES) {
    if (await tx.dictType.findUnique({ where: { code: spec.code } })) {
      preserved.push(spec.code);
      continue;
    }
    await tx.dictType.create({
      data: {
        code: spec.code,
        name: spec.name,
        remark: spec.remark,
        status: 1,
        items: {
          create: spec.items.map((item) => ({
            label: item.label,
            value: item.value,
            sort: item.sort,
            status: 1,
            ...('color' in item ? { color: item.color } : {}),
          })),
        },
      },
    });
    created.push(spec.code);
  }
  return { created, preserved };
}
