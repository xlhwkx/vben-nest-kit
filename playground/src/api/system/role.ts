import type { Recordable } from '@vben/types';

import { requestClient } from '#/api/request';

export namespace SystemRoleApi {
  export interface SystemRole {
    version: number;
    [key: string]: any;
    id: string;
    name: string;
    permissions: string[];
    remark?: string;
    status: 0 | 1;
  }
}

/**
 * 获取角色列表数据
 */
async function getRoleList(params: Recordable<any>) {
  return requestClient.get<{
    items: SystemRoleApi.SystemRole[];
    total: number;
  }>('/system/role/list', { params });
}

/** Load role choices within the API's 100-row page limit. */
async function getRoleOptions() {
  const roles: SystemRoleApi.SystemRole[] = [];
  for (let page = 1; ; page++) {
    const { items, total } = await getRoleList({ page, pageSize: 100 });
    roles.push(...items);
    if (roles.length >= total) return roles;
    if (items.length === 0)
      throw new Error('Role options response is incomplete');
  }
}

/**
 * 创建角色
 * @param data 角色数据
 */
async function createRole(
  data: Omit<SystemRoleApi.SystemRole, 'id' | 'version'>,
) {
  return requestClient.post<SystemRoleApi.SystemRole>('/system/role', data);
}

/**
 * 更新角色
 *
 * @param id 角色 ID
 * @param data 角色数据
 */
async function updateRole(
  id: string,
  data: Partial<Omit<SystemRoleApi.SystemRole, 'id' | 'version'>> & {
    version: number;
  },
) {
  return requestClient.put<SystemRoleApi.SystemRole>(
    `/system/role/${id}`,
    data,
  );
}

/**
 * 删除角色
 * @param id 角色 ID
 */
async function deleteRole(id: string) {
  return requestClient.delete(`/system/role/${id}`);
}

export { createRole, deleteRole, getRoleList, getRoleOptions, updateRole };
