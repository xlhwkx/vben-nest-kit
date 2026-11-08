import type { SystemUserApi } from '../../../../api/system/user';

/** Full editor submissions use null/[] to clear; partial API updates keep omission semantics. */
export function encodeUserFormValues(
  values: SystemUserApi.UserInput,
  canAssignRoles: boolean,
): SystemUserApi.UserInput {
  const payload: SystemUserApi.UserInput = {
    name: values.name,
    username: values.username,
    status: values.status,
    gender: values.gender,
    deptId: values.deptId || null,
    remark: values.remark ?? '',
  };
  if (values.password) payload.password = values.password;
  if (canAssignRoles) payload.roles = values.roles ?? [];
  return payload;
}
