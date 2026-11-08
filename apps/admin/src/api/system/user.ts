import type { Recordable } from '@vben/types';

import { requestClient } from '#/api/request';

export namespace SystemUserApi {
  export interface SystemUser {
    version: number;
    avatar?: string;
    createTime?: string;
    gender?: 0 | 1 | 2;
    deptId?: string;
    homePath?: string;
    id: string;
    name: string;
    /** Login account; required on create */
    username: string;
    /**
     * Bound role ids (Nest `roles`).
     * Not menu permissions — those live on SystemRole.permissions.
     */
    roles: string[];
    remark?: string;
    status: 0 | 1;
  }

  export interface UserInput {
    avatar?: null | string;
    deptId?: null | string;
    gender?: 0 | 1 | 2;
    homePath?: null | string;
    name: string;
    password?: string;
    remark?: null | string;
    roles?: string[];
    status: 0 | 1;
    username: string;
  }
}

/**
 * 获取用户列表数据
 */
async function getUserList(params: Recordable<any>) {
  return requestClient.get<{
    items: SystemUserApi.SystemUser[];
    total: number;
  }>('/system/user/list', { params });
}

/**
 * 创建用户
 * @param data 用户数据（Must 含 username + password + name）
 */
async function createUser(
  data: SystemUserApi.UserInput & {
    password: string;
    username: string;
  },
) {
  return requestClient.post<SystemUserApi.SystemUser>('/system/user', data);
}

/**
 * 更新用户
 *
 * @param id 用户 ID
 * @param data 用户数据（password 可选；空串勿传）
 */
async function updateUser(
  id: string,
  data: Partial<SystemUserApi.UserInput> & {
    version: number;
  },
) {
  return requestClient.put<SystemUserApi.SystemUser>(
    `/system/user/${id}`,
    data,
  );
}

/**
 * 删除用户
 * @param id 用户 ID
 */
async function deleteUser(id: string) {
  return requestClient.delete(`/system/user/${id}`);
}

export { createUser, deleteUser, getUserList, updateUser };
