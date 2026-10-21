import { expect, test, type Page } from '@playwright/test';

// Phones: several gospels at once (side by side, stacked or in quadrants), and the timeline's touch gestures.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'phone', 'phones only'); });

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/shots/phone-${name}.png` });
const currentRow = async (page: Page) => Number(await page.locator('.timeline-track').getAttribute('aria-valuenow'));

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.passage').first()).not.toHaveClass(/loading/, { timeout: 20_000 });
  await page.waitForTimeout(400);
}

async function goTo(page: Page, query: string) {
  await page.getByRole('button', { name: 'Go to a passage or event' }).click();
  await page.locator('#goto').fill(query);
  await page.locator('#goto').press('Enter');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Feeding the five thousand/, { timeout: 15_000 });
  await page.waitForTimeout(2500);
}

/** Picks the gospels' layout in Gospel settings. */
async function arrange(page: Page, name: string) {
  await page.getByRole('button', { name: 'Gospel settings' }).click();
  const choice = page.getByRole('group', { name: 'Layout' }).getByRole('button', { name });
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
}

/** Each pane's verse nearest its reading line (22% down the text under its column head). */
const atReadingLine = (page: Page) => page.locator('.stack > .reader').evaluateAll((panes) => panes.map((p) => {
  const head = p.querySelector('.cols-head')!.getBoundingClientRect();
  const box = p.getBoundingClientRect(), y = head.bottom + (box.bottom - head.bottom) * 0.22;
  let best = '', dist = Infinity;
  for (const v of p.querySelectorAll<HTMLElement>('[data-cv]')) {
    const r = v.getBoundingClientRect();
    const d = r.bottom < y ? y - r.bottom : r.top > y ? r.top - y : 0;
    if (d < dist) { dist = d; best = `${v.closest<HTMLElement>('.cell')!.dataset.book} ${v.dataset.cv}`; }
  }
  return best;
}));

test('phones start with the gospels in quadrants, kept at one place; scrolling any pane leads the others', async ({ page }) => {
  await open(page);
  await expect(page.locator('.stack[data-arrangement="grid"] > .reader')).toHaveCount(4);
  await goTo(page, 'Mk 6:35');
  // Every pane is at the feeding of the five thousand, and one strip names it for all of them.
  await expect(page.locator('.stack-head')).toContainText('Feeding the five thousand');
  const lines = await atReadingLine(page);
  expect(lines.map((l) => l.split(' ')[0])).toEqual(['MAT', 'MRK', 'LUK', 'JHN']);
  expect(lines.map((l) => l.split(' ')[1].split(':')[0])).toEqual(['14', '6', '9', '6']);
  await shot(page, 'quadrants');

  // Scroll John's pane on: the reading position moves, and Matthew's pane follows.
  const before = await currentRow(page);
  const mt = page.locator('.stack > .reader').nth(0);
  const mtTop = await mt.evaluate((el) => el.scrollTop);
  const jn = page.locator('.stack > .reader').nth(3);
  const jb = (await jn.boundingBox())!;
  await page.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2);
  await page.mouse.wheel(0, 9000);
  await page.waitForTimeout(800);
  expect(await currentRow(page)).toBeGreaterThan(before);
  expect(await mt.evaluate((el) => el.scrollTop)).toBeGreaterThan(mtTop);
});

test('phones can show the gospels side by side or stacked, and the chips add and remove them', async ({ page }) => {
  await open(page);
  await arrange(page, 'Side by side');
  await expect(page.locator('.stack')).toHaveCount(0);
  await expect(page.locator('.reader .cols-head .col-h')).toHaveCount(4);
  await expect(page.locator('.cols-head .col-name').first()).toHaveText('Mt');
  await goTo(page, 'Mk 6:35');
  await shot(page, 'side-by-side');

  await arrange(page, 'Stacked');
  await expect(page.locator('.stack[data-arrangement="stacked"] > .reader')).toHaveCount(4);
  await page.getByRole('button', { name: 'Jn', exact: true }).click();
  await page.getByRole('button', { name: 'Lk', exact: true }).click();
  await expect(page.locator('.stack > .reader')).toHaveCount(2);
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Feeding the five thousand/);
  await shot(page, 'stacked-two');

  // Down to one: a plain reader, with the Also in links.
  await page.getByRole('button', { name: 'Mk', exact: true }).click();
  await expect(page.locator('.stack')).toHaveCount(0);
  await expect(page.locator('.reader')).toHaveCount(1);
  await expect(page.locator('.cols-head .col-name')).toHaveText('Matthew');
});

test('phones have the controls beside the timeline, each gospel by its lane, and no toolbar', async ({ page }) => {
  await open(page);
  await expect(page.locator('.toolbar')).toHaveCount(0);
  // Each gospel's chip sits by its lane, full-sized, with no phase bands or section names to make room.
  const tl = (await page.locator('.timeline').boundingBox())!;
  expect(tl.height).toBeLessThan(125);
  const lanes = await page.locator('.lane-chips button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
  expect(lanes).toHaveLength(4);
  for (const h of lanes) expect(h).toBeGreaterThanOrEqual(20);
  await page.getByRole('button', { name: 'Jn', exact: true }).click();
  await expect(page.locator('.stack > .reader')).toHaveCount(3);
  // Beside the timeline only the map and Go to; its settings sit at its foot, and there's no Settings button.
  await expect(page.locator('.side-tools > .icon')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await shot(page, 'side-controls');
});

test('the timeline settings: the scale, then the reckoning on the Time scale, and the phases and feasts', async ({ page }) => {
  await open(page);
  const h = () => page.locator('.timeline').evaluate((t) => t.getBoundingClientRect().height);
  const plain = await h();
  await page.getByRole('button', { name: 'Timeline settings' }).click();
  await expect(page.getByRole('group', { name: 'Crucifixion' })).toHaveCount(0);
  await page.getByRole('group', { name: 'Timeline scale' }).getByRole('button', { name: 'Time' }).click();
  await expect(page.getByRole('group', { name: 'Crucifixion' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compress the hidden years' })).toHaveAttribute('aria-pressed', 'true');
  const phases = page.getByRole('button', { name: 'Phases and feasts' });
  await expect(phases).toHaveAttribute('aria-pressed', 'false');
  await phases.click();
  await expect(phases).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'timeline-settings');
  await page.keyboard.press('Escape');
  await expect.poll(h).toBeGreaterThan(plain + 15); // the phase bands, the feasts and the years
});

test('the map keeps its toggles and credits behind one button beside the scale, and the scale switches km and miles', async ({ page }) => {
  await open(page);
  await expect(page.locator('.maplibregl-ctrl-scale')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Mountains', exact: true })).toHaveCount(0);
  const scale = page.locator('.maplibregl-ctrl-scale');
  const more = page.getByRole('button', { name: 'Map layers and credits' });
  const sb = (await scale.boundingBox())!, mb = (await more.boundingBox())!;
  expect(sb.x).toBeGreaterThan(200); // bottom right, beside the button
  expect(Math.abs(sb.y + sb.height - (mb.y + mb.height))).toBeLessThan(16);
  await more.click();
  await expect(page.getByRole('button', { name: 'Modern places' })).toBeVisible();
  await expect(page.locator('.map-credits')).toContainText('OpenBible.info');
  // Effects: the light on the land and the drift, together.
  const effects = page.getByRole('button', { name: 'Effects' });
  await expect(effects).toHaveAttribute('aria-pressed', 'true');
  await effects.click();
  await expect(effects).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('jt-reader-settings')!); return [s.landLight, s.wander]; })).toEqual([false, false]);
  await effects.click();
  await shot(page, 'map-layers');
  await page.mouse.click(200, 30); // a tap anywhere else (here over the timeline) only closes it
  await expect(page.getByRole('button', { name: 'Modern places' })).toHaveCount(0);
  await expect(scale).toContainText('km');
  await scale.click();
  await expect(scale).toContainText(/mi|ft/);
  await page.reload();
  await expect(page.locator('.maplibregl-ctrl-scale')).toContainText(/mi|ft/, { timeout: 30_000 });
});

test('a pane passes through a short hatched strip where its gospel lacks a section', async ({ page }) => {
  await open(page);
  await goTo(page, 'Mk 6:35');
  // Sections John doesn't narrate are short hatched strips in his pane, so it scrolls through them instead of jumping.
  await expect(page.locator('.stack > .reader').nth(3).locator('.row.gap').first()).toBeAttached();
  await expect(page.locator('.stack > .reader').nth(3).locator('.row.gap span').first()).toHaveText('Not in John');
});

test('on the timeline a finger pans the zoomed view and pinches without moving the needle; a tap or a drag from the needle moves it', async ({ page }) => {
  await open(page);
  await goTo(page, 'Mk 6:35');
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
  const canvas = page.locator('.timeline canvas');
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height * 0.5;
  const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const row = await currentRow(page);

  // Pinch out: zooms in, the needle stays put.
  const cx = box.x + box.width * 0.8; // far from the needle, which zooming pushes off to the left
  await touch('touchStart', [{ x: cx - 30, y }, { x: cx + 30, y }]);
  for (let s = 1; s <= 8; s++) await touch('touchMove', [{ x: cx - 30 - s * 18, y }, { x: cx + 30 + s * 18, y }]);
  await touch('touchEnd', []);
  await expect(page.getByRole('button', { name: 'Show the whole timeline' })).toBeVisible();
  await page.waitForTimeout(600);
  expect(await currentRow(page)).toBe(row);

  // A drag away from the needle pans the view.
  const needle = await page.evaluate(() => {
    const t = document.querySelector('.timeline-track')!;
    return Number(t.getAttribute('aria-valuenow'));
  });
  expect(needle).toBe(row);
  const before = await pixels();
  const startX = box.x + 20;
  await touch('touchStart', [{ x: startX, y }]);
  for (let s = 1; s <= 6; s++) await touch('touchMove', [{ x: startX + s * 25, y }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(600);
  expect(await currentRow(page)).toBe(row);
  expect(await pixels()).not.toBe(before);

  // A tap moves the needle there.
  await page.getByRole('button', { name: 'Show the whole timeline' }).click();
  await touch('touchStart', [{ x: box.x + box.width * 0.85, y }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(2500);
  expect(await currentRow(page)).toBeGreaterThan(row + 20);
});

test('locked panes line up section for section and move together; or each keeps its own length', async ({ page }) => {
  await open(page);
  await goTo(page, 'Mk 6:35');
  const tops = () => page.locator('.stack > .reader').evaluateAll((ps) => ps.map((p) => Math.round(p.scrollTop)));
  const at = (i: number) => page.locator('.stack > .reader').evaluateAll((ps, i) => ps.map((p) => (p.querySelector<HTMLElement>(`section[data-row="${i}"]`)?.offsetTop ?? -1)), i);
  // A section well after the start, so any difference in the panes' lengths before it would show.
  const probe = Number(await page.locator('.stack > .reader').first().locator('section.row:not(.gap)').nth(90).getAttribute('data-row'));
  expect(new Set(await at(probe)).size).toBe(1);
  await expect.poll(async () => new Set(await tops()).size).toBe(1);
  // A finger on any pane moves them all, in the same frame.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pane = (await page.locator('.stack > .reader').nth(3).boundingBox())!;
  const x = pane.x + pane.width / 2, y = pane.y + pane.height * 0.8;
  const before = (await tops())[0];
  await touch('touchStart', [{ x, y }]);
  for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x, y: y - k * 20 }]); expect(new Set(await tops()).size).toBe(1); }
  await touch('touchEnd', []);
  await page.waitForTimeout(1200);
  const after = await tops();
  expect(new Set(after).size).toBe(1);
  expect(after[0]).toBeGreaterThan(before + 100);

  await page.getByRole('button', { name: 'Gospel settings' }).click();
  const own = page.getByRole('group', { name: 'Lengths' }).getByRole('button', { name: /^Own/ });
  await own.click();
  await expect(own).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.stack[data-locked]')).toHaveCount(0);
  expect(new Set(await at(probe)).size).toBeGreaterThan(1);
});

test('the place card starts folded, opens with the stories set there and its links, and a tap off a settings panel only closes it', async ({ page }) => {
  await open(page);
  await goTo(page, 'Mk 6:35');
  await expect(page.locator('.map-card')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show the place card' })).toContainText('Bethsaida');
  await page.getByRole('button', { name: 'Show the place card' }).click();
  const card = page.locator('.map-card');
  await expect(card).toBeVisible();
  // The place, then the stories set there (this one marked), then the links.
  await expect(card.locator('.pp-stories a[aria-current]')).toContainText('Feeding the five thousand');
  await expect(card.locator('.map-links')).toContainText('OpenBible.info');
  const order = await card.evaluate((c) => [...c.children].map((e) => e.className));
  expect(order.indexOf('pp-stories')).toBeLessThan(order.indexOf('map-links'));
  // A tapped place shows in the same card, with a way back to the place in the text.
  await page.locator('.map-place', { hasText: 'Capernaum' }).first().dispatchEvent('click');
  await expect(card.locator('.map-place-name').first()).toContainText('Capernaum');
  await expect(card.locator('.pp-stories li').first()).toBeAttached();
  await page.getByRole('button', { name: /Back to the place in the text/ }).click();
  await expect(card.locator('.map-place-name').first()).toContainText('Bethsaida');
  await page.getByRole('button', { name: 'Fold the place card away' }).click();
  await expect(card).toBeHidden();

  const row = await currentRow(page);
  await page.getByRole('button', { name: 'Gospel settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Gospel settings' })).toBeVisible();
  await page.mouse.click(200, 30); // over the timeline
  await expect(page.getByRole('dialog', { name: 'Gospel settings' })).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await currentRow(page)).toBe(row);
});

test('hidden gospels keep their sections on the timeline, but the needle skips to the nearest story on screen', async ({ page }) => {
  await open(page);
  for (const name of ['Mk', 'Lk', 'Jn']) await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.reader')).toHaveCount(1);
  const box = (await page.locator('.timeline canvas').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  // Tap along the timeline, Luke's birth narratives included: each lands on a section Matthew has, shown in the reader.
  for (const at of [0.03, 0.08, 0.3, 0.55, 0.8]) {
    const x = box.x + box.width * at, y = box.y + box.height * 0.5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(1500);
    const row = (await currentRow(page)) - 1;
    await expect(page.locator(`.reader section[data-row="${row}"]`)).not.toHaveAttribute('hidden', '');
  }
});

test('an × at the right of a gospel’s heading hides it, as its chip does', async ({ page }) => {
  await open(page);
  await expect(page.locator('.stack > .reader')).toHaveCount(4);
  await page.getByRole('button', { name: 'Hide John' }).click();
  await expect(page.locator('.stack > .reader')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Jn', exact: true })).toHaveAttribute('aria-pressed', 'false');
  // The timeline's scale shows which is chosen.
  await page.getByRole('button', { name: 'Timeline settings' }).click();
  await expect(page.getByRole('group', { name: 'Timeline scale' }).getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'timeline-settings-text');
});
