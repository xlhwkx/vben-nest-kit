import { describe, expect, it } from 'vitest';

import { encodeDeptFormValues } from '../../src/views/system/dept/modules/dept-form';
import {
  decodeDictDataFormValues,
  encodeDictDataFormValues,
} from '../../src/views/system/dict/modules/dict-data-form';
import { filterDepartments } from '../../src/views/system/user/dept-filter';
import { encodeUserFormValues } from '../../src/views/system/user/modules/user-form';

const user = {
  name: 'Editor',
  username: 'editor',
  status: 1 as const,
  roles: ['existing-role'],
  password: '',
  deptId: undefined,
};
const dictionary = {
  id: 'entry',
  dictCode: 'user_gender',
  label: 'Male',
  value: 1,
  sort: 0,
  status: 1 as const,
  color: 'success',
};
const child = {
  id: 'child',
  pid: 'root',
  name: 'Engineering',
  status: 1 as const,
  createTime: '',
};
const sibling = { ...child, id: 'sibling', name: 'Finance' };
const departments = [
  {
    ...child,
    id: 'root',
    pid: 0 as const,
    name: 'Head Office',
    children: [child, sibling],
  },
];

describe('system editor contracts', () => {
  it('clears department and blank password correctly without submitting roles for basic-data editors', () => {
    const payload = encodeUserFormValues(user, false);
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      name: 'Editor',
      username: 'editor',
      status: 1,
      deptId: null,
      remark: '',
    });
    expect(user.roles).toEqual(['existing-role']);
  });

  it('sends an empty role array only when role assignment is authorized', () => {
    expect(
      encodeUserFormValues(
        { ...user, roles: undefined, password: 'new-password' },
        true,
      ),
    ).toMatchObject({
      roles: [],
      password: 'new-password',
    });
    expect(encodeUserFormValues(user, true).roles).toEqual(['existing-role']);
  });

  it('moves a department to root and strips read-only row fields', () => {
    expect(
      JSON.parse(
        JSON.stringify(
          encodeDeptFormValues({
            ...child,
            name: 'Head Office',
            pid: undefined,
          }),
        ),
      ),
    ).toEqual({
      name: 'Head Office',
      status: 1,
      pid: null,
      remark: '',
    });
  });

  it('retains nested matches and can recover siblings after changing the search', () => {
    expect(filterDepartments(departments, 'engineer')).toEqual([
      { ...departments[0], children: [child] },
    ]);
    expect(filterDepartments(departments, 'FINANCE')).toEqual([
      { ...departments[0], children: [sibling] },
    ]);
    expect(filterDepartments(departments, 'office')).toEqual(departments);
    expect(filterDepartments(departments, '  ')).toBe(departments);
    expect(filterDepartments(departments, 'missing')).toEqual([]);
    expect(departments[0]?.children).toHaveLength(2);
  });

  it('preserves numeric dictionary values through editing and clears the color explicitly', () => {
    const form = decodeDictDataFormValues(dictionary);
    expect(form).toMatchObject({ value: '1', valueType: 'number' });
    const payload = encodeDictDataFormValues({
      ...dictionary,
      ...form,
      value: '0',
      valueType: 'number',
      color: undefined,
    });
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      dictCode: 'user_gender',
      label: 'Male',
      value: 0,
      sort: 0,
      status: 1,
      color: null,
      remark: '',
    });
    expect(dictionary.value).toBe(1);
  });

  it('preserves numeric-looking text and defaults new entries to text', () => {
    const form = decodeDictDataFormValues({ ...dictionary, value: '001' });
    expect(form).toMatchObject({ value: '001', valueType: 'string' });
    expect(
      encodeDictDataFormValues({
        ...dictionary,
        value: '001',
        valueType: 'string',
      }).value,
    ).toBe('001');
    expect(decodeDictDataFormValues({ dictCode: 'custom' })).toEqual({
      dictCode: 'custom',
      valueType: 'string',
    });
  });

  it.each(['', '  ', 'Infinity', 'NaN', 'abc', '1e999'])(
    'rejects invalid numeric dictionary value %j',
    (value) => {
      expect(() =>
        encodeDictDataFormValues({ ...dictionary, value, valueType: 'number' }),
      ).toThrow(TypeError);
    },
  );
});
