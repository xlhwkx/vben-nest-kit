import type { SystemDictApi } from '../../../../api/system/dict';

export type DictDataFormValues = Omit<SystemDictApi.DictDataInput, 'value'> & {
  value: string;
  valueType: 'number' | 'string';
};

export function isFiniteDictionaryNumber(value: string) {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

export function decodeDictDataFormValues(
  data:
    | Pick<SystemDictApi.SystemDictData, 'dictCode'>
    | SystemDictApi.SystemDictData,
): Partial<DictDataFormValues> {
  if (!('value' in data))
    return { dictCode: data.dictCode, valueType: 'string' };
  return {
    dictCode: data.dictCode,
    label: data.label,
    value: String(data.value),
    valueType: typeof data.value === 'number' ? 'number' : 'string',
    color: data.color,
    sort: data.sort,
    status: data.status,
    remark: data.remark,
  };
}

export function encodeDictDataFormValues(
  values: DictDataFormValues,
): SystemDictApi.DictDataInput {
  if (
    values.valueType === 'number' &&
    !isFiniteDictionaryNumber(values.value)
  ) {
    throw new TypeError('Dictionary value must be a finite number');
  }
  return {
    dictCode: values.dictCode,
    label: values.label,
    value: values.valueType === 'number' ? Number(values.value) : values.value,
    color: values.color ?? null,
    sort: values.sort,
    status: values.status,
    remark: values.remark ?? '',
  };
}
