import type { SystemDeptApi } from '../../../../api/system/dept';

export function encodeDeptFormValues(
  values: SystemDeptApi.DeptInput,
): SystemDeptApi.DeptInput {
  return {
    name: values.name,
    status: values.status,
    pid: values.pid || null,
    remark: values.remark ?? '',
  };
}
