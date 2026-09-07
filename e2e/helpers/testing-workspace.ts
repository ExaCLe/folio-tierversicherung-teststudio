import type { Page } from '@playwright/test';
export async function openDetails(page: Page, selector: string) {
  const details = page.locator(selector).first();
  await details.waitFor({ state: 'attached' });
  if (!await details.evaluate(element => element.hasAttribute('open'))) await details.locator(':scope > summary').click();
}
export async function workspaceNavigation(page: Page, name: string) {
  const link = page.getByRole('link', { name, exact: true });
  if (!await link.isVisible()) await openDetails(page, '.t-resource-menu');
  await link.click();
}
export async function editWorkflow(page: Page) { await openDetails(page, '.t-editor-step'); await openDetails(page, '.t-workspace-edit'); }
