<script lang="ts" setup>
import { Page } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';

const userStore = useUserStore();
</script>

<template>
  <Page title="工作台">
    <div class="rounded-lg bg-card p-6">
      <h2 class="text-lg font-medium">
        欢迎，{{ userStore.userInfo?.realName || userStore.userInfo?.username }}
      </h2>
      <p class="mt-2 text-muted-foreground">从左侧菜单进入已授权的业务页面。</p>
    </div>
  </Page>
</template>
