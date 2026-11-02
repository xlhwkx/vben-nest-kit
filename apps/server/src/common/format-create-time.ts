/**
 * Contract: API createTime Should be ISO-8601 UTC (api-contract-vben.md §11.6).
 * Mock still uses zh-CN Asia/Shanghai strings; Nest prefers ISO for filtering/clients.
 */
export function formatCreateTimeIso(d: Date): string {
  return d.toISOString();
}
