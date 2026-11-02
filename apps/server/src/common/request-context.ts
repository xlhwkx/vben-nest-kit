import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContextStore = {
  requestId: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  path?: string;
  userId?: string;
  username?: string;
};

export const requestContextAls =
  new AsyncLocalStorage<RequestContextStore>();

export function getRequestContext(): RequestContextStore | undefined {
  return requestContextAls.getStore();
}

export function setRequestUser(user: {
  userId: string;
  username: string;
}): void {
  const store = requestContextAls.getStore();
  if (!store) return;
  store.userId = user.userId;
  store.username = user.username;
}
