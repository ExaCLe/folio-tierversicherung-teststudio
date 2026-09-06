import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 1050 }, { width: 390, height: 844 }]) {
  test(`Portal bleibt bei ${viewport.width} Pixeln lesbar und mit Tastatur bedienbar`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/portal');
    await expect(page.getByRole('heading', { name: 'Vorgangsübersicht', exact: true })).toBeVisible();
    await expect(page.locator('.agr-table tbody tr').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('portal-uebersicht.png'), fullPage: true });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Zum Inhalt', exact: true })).toBeFocused();
    await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Vermittler');
    await page.getByRole('button', { name: 'Neuer Versicherungsvorschlag', exact: true }).click();
    await page.getByRole('button', { name: 'Standardkuh laden', exact: true }).click();
    await page.getByLabel('Name des Kunden', { exact: true }).fill('Unverlorene Eingabe');
    await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Direktion');
    await expect(page.getByRole('button', { name: 'Kunde speichern', exact: true })).toBeDisabled();
    await page.getByLabel('Benutzerrolle', { exact: true }).selectOption('Vermittler');
    await expect(page.getByLabel('Name des Kunden', { exact: true })).toHaveValue('Unverlorene Eingabe');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('portal-erfassung.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
}
