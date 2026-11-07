// eslint-disable-next-line no-restricted-imports -- Self-reference resolves workspace source and published declarations without importing another layer.
import type { RouteMeta as IRouteMeta } from '@vben-core/typings';

import 'vue-router';

declare module 'vue-router' {
  // oxlint-disable-next-line typescript/no-empty-object-type
  interface RouteMeta extends IRouteMeta {}
}
