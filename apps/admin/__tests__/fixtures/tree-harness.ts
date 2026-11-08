import { createApp, h, ref } from 'vue';

import { Tree } from '@vben/common-ui';

/** Mounted only by the isolated browser regression through Vite. */
export function mountPermissionTreeHarness() {
  const host = document.createElement('div');
  host.dataset.testid = 'permission-tree-harness';
  // Keep the isolated fixture above the application's fixed layout for real pointer clicks.
  host.style.cssText =
    'position:fixed;top:16px;left:16px;z-index:2147483647;width:320px;padding:16px;background:white';
  document.body.append(host);
  const selected = ref<(number | string)[]>(['root', 'first']);
  const app = createApp({
    render: () =>
      h('div', [
        h(Tree, {
          treeData: [
            {
              id: 'root',
              name: 'Permission root',
              children: [
                { id: 'first', name: 'First permission' },
                { id: 'second', name: 'Second permission' },
              ],
            },
          ],
          valueField: 'id',
          labelField: 'name',
          multiple: true,
          includeIndeterminate: true,
          defaultExpandedLevel: 2,
          modelValue: selected.value,
          'onUpdate:modelValue': (
            value: (number | string)[] | number | string | undefined,
          ) => {
            selected.value = Array.isArray(value) ? value : [];
          },
        }),
        h(
          'output',
          JSON.stringify(
            selected.value.toSorted((a, b) =>
              String(a).localeCompare(String(b)),
            ),
          ),
        ),
      ]),
  });
  app.mount(host);
  return () => {
    app.unmount();
    host.remove();
  };
}
