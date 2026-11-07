import type { DescriptionsItemType } from '@vben/common-ui';

import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridColumns } from '#/adapter/vxe-table';
import type { SystemUserApi } from '#/api';

import { h } from 'vue';

import { useDictStore } from '@vben/stores';

import { Tag } from 'antdv-next';

import { z } from '#/adapter/form';
import { getDeptList, getRoleOptions } from '#/api';
import { $t } from '#/locales';

const USER_GENDER_CODE = 'user_gender';

/** roleId → "name" or "name (code)" for list/detail display */
let roleLabelById = new Map<string, string>();

/**
 * Prefetch role labels using bounded API pages.
 * Safe to call repeatedly; refreshes the cache.
 */
export async function ensureRoleLabelCache(): Promise<void> {
  // Labels are optional enrichment: a user-list reader may lack role-list permission.
  roleLabelById = new Map();
  try {
    const items = await getRoleOptions();
    roleLabelById = new Map(
      items.map((r) => [r.id, r.code ? `${r.name} (${r.code})` : r.name]),
    );
  } catch (error) {
    console.error('Failed to load role labels:', error);
  }
}

/** Map role ids to display labels; unknown ids fall back to raw id. */
export function formatRoleLabels(roleIds?: string[]): string {
  if (!roleIds?.length) return '';
  return roleIds.map((id) => roleLabelById.get(id) ?? id).join(', ');
}

export function useFormSchema(isEdit = false): VbenFormSchema[] {
  const dictStore = useDictStore();
  return [
    {
      component: 'Input',
      fieldName: 'username',
      label: $t('system.user.username'),
      rules: 'required',
      // Nest username is unique; allow edit but typically stable
      disabled: isEdit,
    },
    {
      component: 'VbenInputPassword',
      fieldName: 'password',
      label: $t('system.user.password'),
      // create: required >=6; edit: empty keeps hash; non-empty must >=6
      rules: isEdit
        ? z
            .string()
            .optional()
            .refine((v) => !v || v.length >= 6, {
              message: $t('system.user.passwordMin'),
            })
        : z.string().min(6, { message: $t('system.user.passwordMin') }),
      componentProps: {
        placeholder: isEdit ? $t('system.user.passwordKeepHint') : undefined,
      },
    },
    {
      component: 'Input',
      fieldName: 'name',
      label: $t('system.user.userName'),
      rules: 'required',
    },
    {
      component: 'ApiTreeSelect',
      componentProps: {
        allowClear: true,
        api: getDeptList,
        class: 'w-full',
        labelField: 'name',
        valueField: 'id',
        childrenField: 'children',
      },
      fieldName: 'deptId',
      label: $t('system.user.dept'),
      rules: 'required',
    },
    {
      component: 'ApiSelect',
      componentProps: {
        allowClear: true,
        api: getRoleOptions,
        class: 'w-full',
        labelField: 'name',
        mode: 'multiple',
        valueField: 'id',
      },
      fieldName: 'roles',
      label: $t('system.user.roles'),
    },

    {
      component: 'RadioGroup',
      componentProps: () => ({
        buttonStyle: 'solid',
        options: dictStore.getDictSync(USER_GENDER_CODE),
        optionType: 'button',
      }),
      fieldName: 'gender',
      label: $t('system.user.gender'),
    },
    {
      component: 'RadioGroup',
      componentProps: {
        buttonStyle: 'solid',
        options: [
          { label: $t('common.enabled'), value: 1 },
          { label: $t('common.disabled'), value: 0 },
        ],
        optionType: 'button',
      },
      defaultValue: 1,
      fieldName: 'status',
      label: $t('system.user.status'),
    },
    {
      component: 'Textarea',
      fieldName: 'remark',
      label: $t('system.user.remark'),
    },
  ];
}

export function useGridFormSchema(): VbenFormSchema[] {
  const dictStore = useDictStore();
  return [
    {
      component: 'Input',
      fieldName: 'name',
      label: $t('system.user.name'),
    },
    { component: 'Input', fieldName: 'id', label: $t('system.user.id') },
    {
      component: 'ApiSelect',
      componentProps: {
        allowClear: true,
        api: () => dictStore.getDict(USER_GENDER_CODE),
        class: 'w-full',
      },
      fieldName: 'gender',
      label: $t('system.user.gender'),
    },
    {
      component: 'Select',
      componentProps: {
        allowClear: true,
        options: [
          { label: $t('common.enabled'), value: 1 },
          { label: $t('common.disabled'), value: 0 },
        ],
      },
      fieldName: 'status',
      label: $t('system.user.status'),
    },
    {
      component: 'Input',
      fieldName: 'remark',
      label: $t('system.user.remark'),
    },
    {
      component: 'RangePicker',
      fieldName: 'createTime',
      label: $t('system.user.createTime'),
    },
  ];
}

/**
 * 用户详情描述列表项
 * @param row 用户数据
 */
export function useDescriptionItems(
  row?: SystemUserApi.SystemUser,
): DescriptionsItemType[] {
  const dictStore = useDictStore();
  const enabled = row?.status === 1;
  return [
    { label: $t('system.user.username'), content: row?.username },
    { label: $t('system.user.userName'), content: row?.name },
    { label: $t('system.user.id'), content: row?.id },
    { label: $t('system.user.dept'), content: row?.deptId },
    {
      label: $t('system.user.roles'),
      content: formatRoleLabels(row?.roles),
    },
    {
      label: $t('system.user.gender'),
      content: dictStore.getDictLabel(USER_GENDER_CODE, row?.gender),
    },
    {
      label: $t('system.user.status'),
      content: () =>
        h(
          Tag,
          {
            color: enabled ? 'success' : 'error',
          },
          {
            default: () =>
              enabled ? $t('common.enabled') : $t('common.disabled'),
          },
        ),
    },
    { label: $t('system.user.createTime'), content: row?.createTime },
    { label: $t('system.user.remark'), content: row?.remark },
  ];
}

export function useColumns<T = SystemUserApi.SystemUser>(
  onStatusChange?: (newStatus: any, row: T) => PromiseLike<boolean | undefined>,
): VxeTableGridColumns {
  return [
    {
      field: 'username',
      title: $t('system.user.username'),
      width: 140,
    },
    {
      field: 'name',
      title: $t('system.user.userName'),
      width: 160,
    },
    {
      field: 'roles',
      formatter: ({ cellValue }) =>
        formatRoleLabels(Array.isArray(cellValue) ? cellValue : undefined),
      minWidth: 160,
      title: $t('system.user.roles'),
    },
    {
      field: 'id',
      title: $t('system.user.id'),
      width: 200,
    },
    {
      cellRender: {
        name: 'CellDict',
        props: { code: USER_GENDER_CODE },
      },
      field: 'gender',
      title: $t('system.user.gender'),
      width: 100,
    },
    {
      cellRender: {
        attrs: { beforeChange: onStatusChange },
        name: onStatusChange ? 'CellSwitch' : 'CellTag',
      },
      field: 'status',
      title: $t('system.user.status'),
      width: 100,
    },
    {
      field: 'remark',
      minWidth: 100,
      title: $t('system.user.remark'),
    },
    {
      field: 'createTime',
      title: $t('system.user.createTime'),
      width: 200,
    },
    {
      align: 'center',
      field: 'operation',
      fixed: 'right',
      slots: { default: 'action' },
      title: $t('system.user.operation'),
      width: 180,
    },
  ];
}
