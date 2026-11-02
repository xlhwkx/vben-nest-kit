import type { Recordable } from '@vben/types';

import { requestClient } from '#/api/request';

export namespace SystemUserApi {
  export interface SystemUser {
    [key: string]: any;
    createTime?: string;
    gender?: 0 | 1 | 2;
    id: string;
    name: string;
    /** Login account; required on create */
    username?: string;
    /**
     * Bound role ids (Nest `roles`).
     * Not menu permissions — those live on SystemRole.permissions.
     */
    roles?: string[];
    remark?: string;
    status: 0 | 1;
  }
}

/**
 * 获取用户列表数据
 */
async function getUserList(params: Recordable<any>) {
  return requestClient.get<Array<SystemUserApi.SystemUser>>(
    '/system/user/list',
    { params },
  );
}

/**
 * 创建用户
 * @param data 用户数据（Must 含 username + password + name）
 */
async function createUser(
  data: Omit<SystemUserApi.SystemUser, 'id'> & {
    password: string;
    username: string;
  },
) {
  return requestClient.post('/system/user', data);
}

/**
 * 更新用户
 *
 * @param id 用户 ID
 * @param data 用户数据（password 可选；空串勿传）
 */
async function updateUser(
  id: string,
  data: Omit<SystemUserApi.SystemUser, 'id'> & { password?: string },
) {
  return requestClient.put(`/system/user/${id}`, data);
}

/**
 * 删除用户
 * @param id 用户 ID
 */
async function deleteUser(id: string) {
  return requestClient.delete(`/system/user/${id}`);
}

export { createUser, deleteUser, getUserList, updateUser };
