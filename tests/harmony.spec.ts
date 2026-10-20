import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/shots/${test.info().project.name}-${name}.png` });
const isPhone = () => test.info().project.name === 'phone';

async function open(page: Page, settings: Record<string, unknown> = {}) {
  await page.addInitScript((s) => {
    const old = JSON.parse(localStorage.getItem('jt-reader-settings') ?? '{}');
    localStorage.setItem('jt-reader-settings', JSON.stringify({ ...old, ...s }));
  }, settings);
  await page.goto('/');
  await expect(page.locator('.passage').first()).not.toHaveClass(/loading/, { timeout: 20_000 });
  await page.waitForTimeout(400);
}

async function goTo(page: Page, query: string) {
  if (isPhone()) await page.getByRole('button', { name: 'Go to a passage or event' }).click();
  await page.locator('#goto').fill(query);
  await page.locator('#goto').press('Enter');
  await page.waitForTimeout(900);
}

test('the Bethany anointing sits by John’s date, saying so', async ({ page }) => {
  await open(page, { visible: ['MAT', 'MRK', 'LUK', 'JHN'], single: 'JHN' }); // John has all three sections
  const order = await page.locator('section.row .kicker .n').allTextContents();
  const k = order.indexOf('§141');
  expect(order.slice(k - 1, k + 2)).toEqual(['§128a', '§141', '§128b']);
  const row = page.locator('#row-s141');
  await row.scrollIntoViewIfNeeded();
  await expect(row.locator('.row-note')).toContainText('Six days before the Passover');
  await expect(row.locator('.cell-note.order', { hasText: 'John’s own order' })).toHaveText('In John’s own order this comes before 12:9–11.');
  if (!isPhone()) {
    await expect(row.locator('.cell-note.order', { hasText: 'Mark’s own order' })).toHaveText('In Mark’s own order this comes later, after 14:1–2.');
    // The rows it was moved past keep their place in Mark's order.
    await expect(page.locator('#row-s128b .cell-note.order')).toHaveCount(0);
  }
  await shot(page, 'harmony-01-anointing');
});

test('a similar passage the harmony places elsewhere is a link there', async ({ page }) => {
  await open(page, { visible: ['MAT', 'MRK', 'LUK', 'JHN'], single: 'LUK' });
  await goTo(page, 'Lk 11:2');
  const chip = page.locator('#row-s105 button.par', { hasText: 'Mt 6:9–13' });
  await chip.scrollIntoViewIfNeeded();
  await expect(chip).toBeVisible();
  await shot(page, 'harmony-02-parallel-chip');
  await chip.click();
  await page.waitForTimeout(1200);
  // Matthew opens (it was hidden on the phone) and the reader moves to the Sermon on the Mount.
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /§54/);
  const back = page.locator('button.par', { hasText: 'Lk 11:2–4' });
  await expect(back).toBeVisible();
  await shot(page, 'harmony-03-parallel-back');
});
