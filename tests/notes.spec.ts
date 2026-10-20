import { expect, test, type Page } from '@playwright/test';
import { phonesOneAtATime } from './onePhone';

phonesOneAtATime();

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/shots/${test.info().project.name}-${name}.png` });
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

const matthew = (page: Page) => page.locator('.cell[style*="gospel-mat"]');

test('an omitted verse opens the BSB note that gives its wording', async ({ page }) => {
  await open(page, { visible: ['MAT', 'MRK', 'LUK', 'JHN'], single: 'MAT', notes: 'all' });
  await goTo(page, 'Mt 17:20');
  const omit = matthew(page).locator('button.omit').first();
  await omit.scrollIntoViewIfNeeded();
  await omit.click();
  const pop = page.locator('.note-pop');
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('But this kind does not come out except by prayer and fasting');
  await expect(pop).toContainText('Manuscripts');
  await shot(page, 'notes-01-omitted-verse');

  // A gospel cross-reference in the note moves the reader there.
  await pop.getByRole('button', { name: 'Mark 9:29' }).click();
  await expect(pop).toBeHidden();
  await page.waitForTimeout(900);
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /§93|demon|boy|Healing/i);
});

test('desktop: hovering a mark shows its note; clicking keeps it', async ({ page }) => {
  test.skip(isPhone());
  await open(page, { notes: 'all' });
  await goTo(page, 'Mt 1:18');
  const mark = matthew(page).locator('.fn-mark').first();
  await mark.scrollIntoViewIfNeeded();
  await mark.hover();
  const pop = page.locator('.note-pop');
  await expect(pop).toBeVisible();
  await expect(pop).toHaveAttribute('role', 'tooltip');
  await page.mouse.move(5, 5);
  await expect(pop).toBeHidden();

  await mark.click();
  await expect(pop).toHaveAttribute('role', 'dialog');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('a manuscript note is marked with a letter in the gospel colour', async ({ page }) => {
  await open(page, { notes: 'all' });
  await goTo(page, 'Mk 9:42');
  const mark = page.locator('.cell[style*="gospel-mrk"] .fn[data-kind="textual"] .fn-mark').first();
  await mark.scrollIntoViewIfNeeded();
  await expect(mark).toHaveText(/^[a-z]+$/);
  await mark.click();
  const pop = page.locator('.note-pop');
  await expect(pop).toBeVisible();
  await expect(pop).not.toContainText('Berean Standard Bible footnote');
  await shot(page, 'notes-02-letters');
});

test('notes can be limited to the manuscripts', async ({ page }) => {
  await open(page, { notes: 'textual' });
  await goTo(page, 'Mt 1:18');
  await expect(page.locator('.fn').first()).toBeAttached();
  expect(await page.locator('.fn:not([data-kind="textual"])').count()).toBe(0);
});

test('notes can be hidden', async ({ page }) => {
  await open(page, { notes: 'none' });
  await goTo(page, 'Mt 1:18');
  expect(await page.locator('.fn').count()).toBe(0);
  await expect(page.locator('button.omit').first()).toBeAttached(); // omitted verses still open their note
});
