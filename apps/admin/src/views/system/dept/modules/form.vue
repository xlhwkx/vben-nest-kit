<script lang="ts" setup>
import type { SystemDeptApi } from '#/api';

import { computed, ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import { Button } from 'antdv-next';

import { useVbenForm } from '#/adapter/form';
import { createDept, updateDept } from '#/api';
import { $t } from '#/locales';

import { useSchema } from '../data';
import { encodeDeptFormValues } from './dept-form';

const emit = defineEmits(['success']);
const formData = ref<SystemDeptApi.SystemDept>();
type DeptModalData =
  | null
  | SystemDeptApi.SystemDept
  | { pid: SystemDeptApi.SystemDept['pid'] };

const getTitle = computed(() => {
  return formData.value?.id
    ? $t('ui.actionTitle.edit', [$t('system.dept.name')])
    : $t('ui.actionTitle.create', [$t('system.dept.name')]);
});

const [Form, formApi] = useVbenForm({
  layout: 'vertical',
  schema: useSchema(),
  showDefaultActions: false,
});

async function resetForm() {
  const data = modalApi.getData();
  await formApi.reset();
  if (data) {
    await formApi.setValues({ ...data, pid: data.pid || undefined });
  }
}

const [Modal, modalApi] = useVbenModal<DeptModalData>({
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (valid) {
      modalApi.lock();
      try {
        const data = encodeDeptFormValues(
          await formApi.getValues<SystemDeptApi.DeptInput>(),
        );
        await (formData.value?.id
          ? updateDept(formData.value.id, data)
          : createDept(data));
        modalApi.close();
        emit('success');
      } finally {
        modalApi.lock(false);
      }
    }
  },
  async onOpenChange(isOpen) {
    if (isOpen) {
      const data = modalApi.getData();
      formData.value = data && 'id' in data ? data : undefined;
      await resetForm();
    }
  },
});

defineExpose({ modalApi });
</script>

<template>
  <Modal :title="getTitle">
    <Form class="mx-4" />
    <template #prepend-footer>
      <div class="flex-auto">
        <Button type="primary" danger @click="resetForm">
          {{ $t('common.reset') }}
        </Button>
      </div>
    </template>
  </Modal>
</template>
