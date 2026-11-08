import type { SystemDeptApi } from '../../../api/system/dept';

/** Retain matching descendants with their ancestors, without changing the source tree. */
export function filterDepartments(
  departments: SystemDeptApi.SystemDept[],
  search: string,
): SystemDeptApi.SystemDept[] {
  const query = search.trim().toLowerCase();
  if (!query) return departments;
  return departments.flatMap((dept) => {
    if (dept.name.toLowerCase().includes(query)) return [dept];
    const children = filterDepartments(dept.children ?? [], query);
    return children.length > 0 ? [{ ...dept, children }] : [];
  });
}
