import type { Page } from '@playwright/test';

import { expect } from '@playwright/test';

export async function authLogin(page: Page) {
  const username = process.env.AUTH_BROWSER_USERNAME;
  const password = process.env.AUTH_BROWSER_PASSWORD;
  if (!username || !password)
    throw new Error('Explicit test-account credentials are required');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: /登录|Login/i }).click();
  await expect(page.locator('[data-layout-region="layout"]')).toBeVisible();
}
