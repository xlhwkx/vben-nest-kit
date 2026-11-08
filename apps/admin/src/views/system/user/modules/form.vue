<script lang="ts" setup>
import type { SystemUserApi } from '#/api';

import { computed, nextTick, ref } from 'vue';

import { useAccess } from '@vben/access';
import { useVbenDrawer } from '@vben/common-ui';

import { useVbenForm } from '#/adapter/form';
import { createUser, updateUser } from '#/api';
import { $t } from '#/locales';

import { useFormSchema } from '../data';
import { encodeUserFormValues } from './user-form';

const emits = defineEmits(['success']);

const formData = ref<SystemUserApi.SystemUser>();
const { hasAccessByCodes } = useAccess();
const canAssignRoles = () => hasAccessByCodes(['System:User:AssignRole']);

const [Form, formApi] = useVbenForm({
  schema: useFormSchema(false, canAssignRoles()),
  showDefaultActions: false,
});

const [Drawer, drawerApi] = useVbenDrawer<null | SystemUserApi.SystemUser>({
  async onConfirm() {
    const { valid } = await formApi.validate();
    if (!valid) return;
    const values = await formApi.getValues<SystemUserApi.UserInput>();
    const payload = encodeUserFormValues(values, canAssignRoles());
    const existing = formData.value;
    drawerApi.lock();
    (existing
      ? updateUser(existing.id, { ...payload, version: existing.version })
      : createUser(
          payload as SystemUserApi.UserInput & {
            password: string;
            username: string;
          },
        )
    )
      .then(() => {
        emits('success');
        drawerApi.close();
      })
      .catch(() => {
        drawerApi.unlock();
      });
  },

  async onOpenChange(isOpen) {
    if (isOpen) {
      const data = drawerApi.getData();
      formApi.reset();

      if (data) {
        formData.value = { ...data };
        formApi.setState({ schema: useFormSchema(true, canAssignRoles()) });
      } else {
        formData.value = undefined;
        formApi.setState({ schema: useFormSchema(false, canAssignRoles()) });
      }

      // Wait for Vue to flush DOM updates (form fields mounted)
      await nextTick();
      if (data) {
        // never prefill password
        const { password: _pw, ...rest } = data as SystemUserApi.SystemUser & {
          password?: string;
        };
        formApi.setValues(rest);
      }
    }
  },
});

defineExpose({ drawerApi });

const getDrawerTitle = computed(() => {
  return formData.value?.id
    ? $t('common.edit', $t('system.user.name'))
    : $t('common.create', $t('system.user.name'));
});
</script>
<template>
  <Drawer :title="getDrawerTitle">
    <Form />
  </Drawer>
</template>
