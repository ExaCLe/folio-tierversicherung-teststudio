import type { Page } from '@playwright/test';
export async function openDetails(page: Page, selector: string) {
  if (selector === '.t-overview-history') { await page.getByRole('button', { name: 'Frühere KI-Aufträge ansehen', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'visible' }); return; }
  if (selector === '.t-editor-step' || selector === '.t-workspace-edit') {
    const step = page.getByRole('button', { name: 'Schritt 3: Fachlich prüfen', exact: true });
    await step.waitFor({ state: 'visible' });
    if (await step.getAttribute('aria-current') !== 'step') await step.click();
  }
  const details = page.locator(selector).first();
  await details.waitFor({ state: 'attached' });
  if (await details.evaluate(element => element.tagName === 'DETAILS' && !element.hasAttribute('open'))) await details.locator(':scope > summary').click();
}
export async function workspaceNavigation(page: Page, name: string) {
  const link = page.getByRole('link', { name, exact: true });
  if (!await link.isVisible()) await openDetails(page, '.t-resource-menu');
  await link.click();
}
export async function editWorkflow(page: Page) { await openDetails(page, '.t-editor-step'); await openDetails(page, '.t-workspace-edit'); }
