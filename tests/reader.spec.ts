import { expect, test, type Page } from '@playwright/test';

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/shots/${test.info().project.name}-${name}.png` });
const currentRow = async (page: Page) => Number(await page.locator('.timeline-track').getAttribute('aria-valuenow'));

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.passage').first()).not.toHaveClass(/loading/, { timeout: 20_000 });
  await page.waitForTimeout(400);
}

async function goTo(page: Page, query: string) {
  const isPhone = test.info().project.name === 'phone';
  if (isPhone) await page.getByRole('button', { name: 'Go to a passage or event' }).click();
  await page.locator('#goto').fill(query);
  await page.locator('#goto').press('Enter');
  await page.waitForTimeout(900);
  // Go to eases the reader through the sections in between, which under software WebGL can take several seconds:
  // wait until the reader and the reading position are still.
  const where = () => page.evaluate(() => `${document.querySelector('.reader')?.scrollTop ?? ''}|${document.querySelector('.timeline-track')?.getAttribute('aria-valuenow')}`);
  let last = await where();
  for (let still = 0, i = 0; still < 2 && i < 60; i++) {
    await page.waitForTimeout(250);
    const now = await where();
    still = now === last ? still + 1 : 0;
    last = now;
  }
}

test('scrubbing the timeline moves the reader, and reading moves the playhead', async ({ page }) => {
  await open(page);
  await shot(page, '01-start');
  expect(await currentRow(page)).toBeLessThan(5);

  const box = (await page.locator('.timeline canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.waitForTimeout(900);
  const mid = await currentRow(page);
  expect(mid).toBeGreaterThan(40);
  expect(mid).toBeLessThan(170);
  await shot(page, '02-scrubbed-middle');

  // Scrolling the text moves the playhead on.
  await page.locator('.reader').evaluate((el) => { el.scrollTop += 15000; });
  await page.waitForTimeout(400);
  expect(await currentRow(page)).toBeGreaterThan(mid);
});

test('Go to finds a passage by reference', async ({ page }) => {
  await open(page);
  await goTo(page, 'Mk 6:35');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Feeding the five thousand/);
  await shot(page, '03-goto-feeding');
});

test('desktop: hiding gospels narrows the synopsis', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop');
  await open(page);
  await expect(page.locator('.cols-head .col-h')).toHaveCount(4);
  await page.getByRole('button', { name: 'John', exact: true }).click();
  await expect(page.locator('.cols-head .col-h')).toHaveCount(3);
  await goTo(page, 'Sermon on the Mount');
  await shot(page, '04-three-columns-sermon');
  await page.getByRole('button', { name: 'John', exact: true }).click();
  await expect(page.locator('.cols-head .col-h')).toHaveCount(4);
});

const isPhone = () => test.info().project.name === 'phone';
const mapChip = (page: Page) => page.getByRole('button', { name: 'Map', exact: true });

test('the Map chip opens the map beside the open gospels, with a scale', async ({ page }) => {
  await open(page);
  await goTo(page, 'Jn 4:6');
  await mapChip(page).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.cols-head .col-h')).toHaveCount(isPhone() ? 1 : 4);
  await expect(page.locator('.maplibregl-ctrl-scale')).toBeVisible();
  await page.waitForTimeout(2500);
  // Opening the map narrows the text; the reader keeps its place.
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Samaritan woman/);
  await shot(page, '05-map-samaria');
});

test('dragging the divider past 80% leaves only the map, and the timeline still drives it', async ({ page }) => {
  await open(page);
  await mapChip(page).click();
  const splitter = page.getByRole('separator', { name: 'Resize the map' });
  await expect(splitter).toBeVisible({ timeout: 30_000 });
  const panes = (await page.locator('.panes').boundingBox())!;
  const s = (await splitter.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  if (isPhone()) await page.mouse.move(s.x + s.width / 2, panes.y + panes.height * 0.96, { steps: 8 });
  else await page.mouse.move(panes.x + panes.width * 0.04, s.y + s.height / 2, { steps: 8 });
  await expect(page.getByText('Release to show only the map')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.reader')).toHaveCount(0);
  for (const name of isPhone() ? ['Mt', 'Mk', 'Lk', 'Jn'] : ['Matthew', 'Mark', 'Luke', 'John']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false');
  }
  const box = (await page.locator('.timeline canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.55);
  await page.waitForTimeout(2500);
  expect(await currentRow(page)).toBeGreaterThan(30);
  await shot(page, '06-map-only');
  await mapChip(page).click();
  await expect(page.locator('.reader')).toHaveCount(1);
});

test('where no place is named, the map shows a likely area between the places named around it, with the line to it', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Picking grain');
  await expect(page.locator('.map-card')).toContainText('Place not named', { timeout: 30_000 });
  await expect(page.locator('.map-card')).toContainText(/Likely (between|around|near)/);
  await expect.poll(() => newestLegGap(page), { timeout: 10_000 }).toBeLessThan(12);
  await page.waitForTimeout(2500);
  await shot(page, '09-likely-area');
});

test('the route line goes to a region Jesus goes to, and the leg before it ages', async ({ page }) => {
  await page.goto('/?debug');
  await expect(page.locator('.passage').first()).not.toHaveClass(/loading/, { timeout: 20_000 });
  await goTo(page, 'Flight to Egypt');
  await mapChip(page).click();
  await page.waitForFunction(() => (window as unknown as { __jtMap?: { getLayer(id: string): unknown } }).__jtMap?.getLayer('arrows'), null, { timeout: 30_000 });
  type Leg = { age: number; to: number[] };
  const legs = () => page.evaluate(async () => {
    const map = (window as unknown as { __jtMap: { getSource(id: string): { getData(): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> } } }).__jtMap;
    const fc = await map.getSource('trail').getData();
    return fc.features.map((f) => ({ age: f.properties!.age as number, to: f.geometry.coordinates[1] }));
  });
  // The leg ends where the marker is drawn as it drifts in Egypt: within a fifth of the area (150 km) of its centre.
  const atEgypt = (l: Leg) => Math.abs(l.to[0] - 31.3075) < 0.4 && Math.abs(l.to[1] - 30.129444) < 0.4;
  await expect.poll(async () => (await legs()).some((l) => l.age === 0 && atEgypt(l))).toBe(true);
  await page.waitForTimeout(2000);
  await shot(page, '10-egypt-leg');

  await goTo(page, 'From Egypt to Nazareth');
  await expect.poll(async () => (await legs()).some((l) => l.age === 1 && atEgypt(l))).toBe(true);
});

/** Opens the reader with the map showing and waits for the map to be ready. */
async function openMap(page: Page) {
  await page.goto('/?debug');
  await expect(page.locator('.passage').first()).not.toHaveClass(/loading/, { timeout: 20_000 });
  await mapChip(page).click();
  await page.waitForFunction(() => (window as unknown as { __jtMap?: { getLayer(id: string): unknown } }).__jtMap?.getLayer('arrows'), null, { timeout: 30_000 });
}
const placeDot = (page: Page, name: string) => page.locator(`.map-place:has(> span:text-is("${name}"))`);
/** How far (px) the newest leg's end is from Jesus' marker; Infinity when there's no newest leg. */
const newestLegGap = (page: Page) => page.evaluate(async () => {
  type M = { getSource(id: string): { getData(): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> }; project(ll: number[]): { x: number; y: number }; getContainer(): HTMLElement };
  const map = (window as unknown as { __jtMap: M }).__jtMap;
  const newest = (await map.getSource('trail').getData()).features.find((f) => f.properties!.age === 0);
  const sym = document.querySelector('.map-traveller .sym');
  if (!newest || !sym) return Infinity;
  const box = map.getContainer().getBoundingClientRect(), s = sym.getBoundingClientRect();
  const end = map.project(newest.geometry.coordinates[newest.geometry.coordinates.length - 1]);
  return Math.hypot(end.x - (s.left + s.width / 2 - box.left), end.y - (s.top + s.height / 2 - box.top));
});

test('going back to the start reframes the map on the whole standard view', async ({ page }) => {
  await openMap(page);
  const view = () => page.evaluate(() => {
    const map = (window as unknown as { __jtMap: { getCenter(): { lng: number; lat: number }; getZoom(): number } }).__jtMap;
    const c = map.getCenter();
    return { x: c.lng, y: c.lat, z: map.getZoom() };
  });
  await goTo(page, 'Calming the storm');
  await expect.poll(async () => (await view()).z, { timeout: 15_000 }).toBeGreaterThan(8);
  await goTo(page, 'The genealogies');
  await expect.poll(async () => {
    const v = await view();
    return Math.abs(v.x - 35.4) < 0.05 && Math.abs(v.y - 32.1) < 0.05 && Math.abs(v.z - 7) < 0.05;
  }, { timeout: 15_000 }).toBe(true);
});

test('Jesus appears on the map at Mary’s visit to Elizabeth, setting out from Nazareth', async ({ page }) => {
  test.skip(isPhone(), 'phones show one gospel, Matthew first; the opening sections are Luke’s');
  await openMap(page);
  const legs = () => page.evaluate(async () => {
    const map = (window as unknown as { __jtMap: { getSource(id: string): { getData(): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> } } }).__jtMap;
    return (await map.getSource('trail').getData()).features.map((f) => ({ age: f.properties!.age as number, from: f.geometry.coordinates[0], to: f.geometry.coordinates[1] }));
  });
  // Judea's end of a leg follows the marker as it drifts there, so it's anywhere within a few km of the centre.
  const at = (p: number[], [x, y]: number[], d = 0.01) => Math.abs(p[0] - x) < d && Math.abs(p[1] - y) < d;
  const NAZARETH = [35.29769, 32.70214], JUDEA = [35.08, 31.62], BETHLEHEM = [35.207639, 31.704306], IN_JUDEA = 0.1;
  const traveller = page.locator('.map-traveller');
  // Not on the map: either never placed yet, or hidden.
  const absent = async () => (await traveller.count()) === 0 || /\boff\b/.test((await traveller.getAttribute('class')) ?? '');

  for (const q of ['Luke’s preface', 'Prologue: the Word', 'Jesus’ birth foretold to Mary']) {
    await goTo(page, q);
    await expect.poll(absent).toBe(true);
    await expect(page.locator('.map-card')).not.toContainText('Likely');
    expect(await legs()).toEqual([]);
  }
  await goTo(page, 'Mary visits Elizabeth');
  await expect(traveller).not.toHaveClass(/\boff\b/);
  await expect.poll(async () => (await legs()).some((l) => l.age === 0 && at(l.from, NAZARETH) && at(l.to, JUDEA, IN_JUDEA))).toBe(true);
  await page.waitForTimeout(2000);
  await shot(page, '13-first-journey');
  // Home to Nazareth (Lk 1:56), then up to Bethlehem (Lk 2:4).
  await goTo(page, 'The birth of Jesus');
  await expect.poll(async () => {
    const l = await legs();
    return l.some((x) => x.age === 1 && at(x.from, JUDEA, IN_JUDEA) && at(x.to, NAZARETH)) && l.some((x) => x.age === 0 && at(x.from, NAZARETH) && at(x.to, BETHLEHEM));
  }, { timeout: 10_000 }).toBe(true); // Go to scrolls through the sections between, which can take a few seconds
});

test('places named where the accounts differ (Gadara, Gerasa) are coloured in once passed', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Feeding the five thousand');
  await expect(placeDot(page, 'Gadara')).toHaveClass(/visited/);
  // Phones show one gospel (Matthew, which names Gadara); with all four on screen, Mark and Luke's Gerasa counts too.
  if (isPhone()) await expect(placeDot(page, 'Gerasa')).not.toHaveClass(/visited/);
  else await expect(placeDot(page, 'Gerasa')).toHaveClass(/visited/);
  await goTo(page, 'The Magi');
  await expect(placeDot(page, 'Gadara')).not.toHaveClass(/visited/);
});

test('a mountain section shows the named peaks nearby, with contours', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'The Samaritan woman');
  await expect(page.locator('.map-peak', { hasText: 'Mount Gerizim' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.map-mountain')).toContainText('Our fathers worshiped on this mountain');
  // The peaks' contours are lit in white by his light (no ink contours), the peaks joined to it.
  type Status = { mountainPoints: number; peaks: number; mountain: number };
  const light = () => page.evaluate(() => (window as unknown as { __jtMap: { getLayer(id: string): { implementation?: { status(): Status } } | undefined } }).__jtMap.getLayer('land-light')!.implementation!.status());
  await expect.poll(async () => (await light()).mountainPoints, { timeout: 10_000 }).toBeGreaterThan(200);
  await expect.poll(async () => (await light()).mountain).toBeGreaterThan(0.95);
  expect((await light()).peaks).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500);
  await shot(page, '11-mountain-sychar');
  // Off the mountain, the peaks go, and their light fades.
  await goTo(page, 'An official’s son healed');
  await expect(page.locator('.map-peak')).toHaveCount(0);
  await expect.poll(async () => (await light()).mountain).toBeLessThan(0.05);
});

test('in a region the traveller rests at its centre and drifts; at a named place it stands still', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Preaching through Galilee');
  await expect(page.locator('.map-traveller')).toHaveClass(/wandering/, { timeout: 8_000 });
  await expect(page.locator('.map-traveller')).not.toHaveClass(/\boff\b/);
  // A tour within the region he is already in still gets its line, joined to the marker as it drifts.
  await expect.poll(() => newestLegGap(page), { timeout: 10_000 }).toBeLessThan(12);
  await goTo(page, 'Feeding the five thousand');
  await expect(page.locator('.map-traveller')).not.toHaveClass(/wandering/, { timeout: 8_000 });
  // Jesus isn't in the scene: his marker rests (dimmed, named) where he was last placed; the scene gets its own marker.
  await goTo(page, 'John the Baptist preaches');
  await expect(page.locator('.map-traveller')).toHaveClass(/resting/);
  await expect(page.locator('.map-traveller')).not.toHaveClass(/\boff\b/);
  await expect(page.locator('.map-scene')).toContainText('scene');
});

test('where the text has Jesus heading somewhere, the map shows the heading and quiets the old leg', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'The narrow door');
  await expect(page.locator('.map-heading-note')).toContainText('made His way toward Jerusalem');
  await expect(placeDot(page, 'Jerusalem')).toHaveClass(/ahead/);
  const state = () => page.evaluate(async () => {
    const map = (window as unknown as { __jtMap: { getSource(id: string): { getData(): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> } } }).__jtMap;
    const heading = (await map.getSource('heading').getData()).features[0]?.geometry.coordinates;
    const newest = (await map.getSource('trail').getData()).features.find((f) => f.properties!.age === 0);
    return { heading, quiet: newest?.properties!.q };
  });
  await expect.poll(async () => (await state()).quiet).toBe(1);
  const { heading } = await state();
  // From the area between Bethany beyond the Jordan and Bethany, westwards towards Jerusalem (35.23° E).
  expect(heading![1][0]).toBeLessThan(heading![0][0]);
  expect(heading![1][0]).toBeGreaterThan(35.23);
  await page.waitForTimeout(1500);
  await shot(page, '14-heading-jerusalem');
});

test('in scenes without Jesus his marker waits where he was last placed, and goes back there when scrolled back', async ({ page }) => {
  await openMap(page);
  const traveller = page.locator('.map-traveller');
  const offNazareth = async () => {
    const t = (await traveller.locator('.sym').boundingBox())!, n = (await placeDot(page, 'Nazareth').locator('i').boundingBox())!;
    return Math.hypot(t.x + t.width / 2 - (n.x + n.width / 2), t.y + t.height / 2 - (n.y + n.height / 2));
  };
  await goTo(page, 'John the Baptist preaches');
  await expect(page.locator('.map-card')).toContainText('his marker waits at Nazareth');
  await expect.poll(offNazareth, { timeout: 8_000 }).toBeLessThan(20);
  await goTo(page, 'Jesus baptised');
  await expect(traveller).not.toHaveClass(/resting/);
  await goTo(page, 'John the Baptist preaches');
  await expect(traveller).toHaveClass(/resting/);
  await expect.poll(offNazareth, { timeout: 8_000 }).toBeLessThan(20);
});

test('Jesus’ glow lies under every other marker and label, and places he has been turn from dark to light', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'A paralysed man lowered through the roof');
  // The glow is the first thing drawn over the map's canvas, so labels and markers sit on top of it.
  await expect.poll(() => page.evaluate(() => document.querySelector('.maplibregl-canvas')?.nextElementSibling?.classList.contains('map-traveller-glow'))).toBe(true);
  const dot = (name: string) => placeDot(page, name).locator('i').evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => dot('Capernaum')).toBe('rgb(255, 255, 255)');
  expect(await dot('Jericho')).not.toBe('rgb(255, 255, 255)');
  await page.waitForTimeout(1200);
  await shot(page, '15-light');
  // MapLibre sets each marker's opacity inline, so hiding works on the inner element: no glow while he rests...
  const shown = (sel: string) => page.locator(`${sel} .wander`).evaluate((el) => getComputedStyle(el).opacity);
  await goTo(page, 'John the Baptist preaches');
  await expect.poll(() => shown('.map-traveller-glow')).toBe('0');
  expect(await shown('.map-traveller')).toBe('1');
  // ...and no marker at all where the accounts name different places (phones show Matthew alone, which names one).
  if (isPhone()) return;
  await goTo(page, 'The demon-possessed man across the lake');
  await expect.poll(() => shown('.map-traveller')).toBe('0');
});

test('his light lights the contours about him, and in an area grows to cover it in place of a shaded circle', async ({ page }) => {
  await openMap(page);
  type Status = { points: number; zones: string[]; cover: number; strength: number; enabled: boolean };
  type LM = { getLayer(id: string): { implementation?: { status(): Status } } | undefined; getPaintProperty(l: string, p: string): unknown };
  const light = () => page.evaluate(() => (window as unknown as { __jtMap: LM }).__jtMap.getLayer('land-light')!.implementation!.status());
  const circle = () => page.evaluate(() => (window as unknown as { __jtMap: LM }).__jtMap.getPaintProperty('area-fill', 'fill-opacity'));
  await goTo(page, 'A paralysed man lowered through the roof');
  await expect.poll(async () => (await light()).points, { timeout: 15_000 }).toBeGreaterThan(100_000);
  await expect.poll(async () => (await light()).strength).toBeGreaterThan(0.9);
  // (From an area, the light shrinks back to a pool about him.)
  await expect.poll(async () => (await light()).cover).toBeLessThan(0.05);
  // About Capernaum, and later Jerusalem, finer contours load for the closer views.
  await expect.poll(async () => (await light()).zones).toContain('capernaum');
  await goTo(page, 'Entry into Jerusalem');
  await expect.poll(async () => (await light()).zones, { timeout: 10_000 }).toContain('jerusalem');
  await page.waitForTimeout(1500);
  await shot(page, '15-light-jerusalem');
  // In an area the light grows to cover it; the circle stays only for hovering.
  await goTo(page, 'Flight to Egypt');
  await expect.poll(async () => (await light()).cover, { timeout: 10_000 }).toBeGreaterThan(0.95);
  expect(await circle()).toBe(0);
  await shot(page, '16-light-egypt');
  // Switched off in Settings: no light, and the shaded circle is back.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('checkbox', { name: /Light on the land/ }).uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await light()).enabled).toBe(false);
  expect(await circle()).toBe(0.12);
});

test('mountains named or given as candidates, the lake’s shore, and pools where the accounts differ', async ({ page }) => {
  await openMap(page);
  type Status = { peaks: number; outline: number; pools: number };
  const light = () => page.evaluate(() => (window as unknown as { __jtMap: { getLayer(id: string): { implementation?: { status(): Status } } | undefined } }).__jtMap.getLayer('land-light')!.implementation!.status());
  const peakNames = () => page.locator('.map-peak').allTextContents();
  // The transfiguration's unnamed "high mountain": the candidates given, and the card says so.
  await goTo(page, 'The transfiguration');
  await expect.poll(async () => (await peakNames()).map((t) => t.split(' ≈')[0]).sort()).toEqual(['Meron', 'Mount Hermon', 'Mount Tabor']);
  await expect(page.locator('.map-card')).toContainText('candidates shown');
  // A mountain the text names: only that one (no other peak nearby), and its label in view.
  await goTo(page, 'Entry into Jerusalem');
  await expect(page.locator('.map-peak')).toHaveCount(1);
  await expect(placeDot(page, 'Mount of Olives')).toHaveClass(/named/);
  await expect(placeDot(page, 'Mount of Olives').locator('span')).toBeVisible();
  await expect(placeDot(page, 'Mount of Olives')).not.toHaveClass(/label-hidden/);
  // At the lake itself its shore lights up.
  await goTo(page, 'Calming the storm');
  await expect.poll(async () => (await light()).outline).toBeGreaterThan(0.95);
  // Where the accounts name different places, the light covers the area about each (phones show Matthew alone).
  if (isPhone()) return;
  await goTo(page, 'The demon-possessed man across the lake');
  await expect.poll(async () => (await light()).pools).toBe(2);
  await expect.poll(async () => (await light()).outline).toBeLessThan(0.05);
});

test('the newest leg stays joined to Jesus’ marker as it drifts in an area', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Flight to Egypt');
  await expect(page.locator('.map-traveller')).toHaveClass(/wandering/, { timeout: 15_000 });
  type M = { getSource(id: string): { getData(): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> }; project(ll: number[]): { x: number; y: number }; getContainer(): HTMLElement };
  // How far the newest leg's end is from the marker, and how far the marker has drifted from Egypt's centre (px).
  const measure = () => page.evaluate(async () => {
    const map = (window as unknown as { __jtMap: M }).__jtMap;
    const newest = (await map.getSource('trail').getData()).features.find((f) => f.properties!.age === 0)!;
    const box = map.getContainer().getBoundingClientRect(), s = document.querySelector('.map-traveller .sym')!.getBoundingClientRect();
    const mx = s.left + s.width / 2 - box.left, my = s.top + s.height / 2 - box.top;
    const end = map.project(newest.geometry.coordinates[1]), centre = map.project([31.3075, 30.129444]);
    return { gap: Math.hypot(end.x - mx, end.y - my), off: Math.hypot(centre.x - mx, centre.y - my) };
  });
  const seen = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); seen.push(await measure()); }
  expect(Math.max(...seen.map((m) => m.off))).toBeGreaterThan(3);
  expect(Math.max(...seen.map((m) => m.gap))).toBeLessThan(12);
});

test('zoomed out, crowded labels give way so none overlap', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'On the road to Emmaus');
  // Let the camera's own flight finish first, then measure once the zoomed-out map has settled.
  type IM = { jumpTo(o: object): void; isMoving(): boolean; once(e: string, f: () => void): void };
  await page.waitForFunction(() => !(window as unknown as { __jtMap: IM }).__jtMap.isMoving(), null, { timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => new Promise<void>((resolve) => {
    const map = (window as unknown as { __jtMap: IM }).__jtMap;
    map.once('idle', () => resolve());
    map.jumpTo({ center: [35.4, 32.2], zoom: 6.6 });
  }));
  await page.waitForTimeout(300);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.map-place:not(.label-hidden) > span')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => { const b = s.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }));
  expect(await page.locator('.map-place.label-hidden').count()).toBeGreaterThan(0);
  const overlaps = boxes.filter((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] - 1 && a[2] > b[0] + 1 && a[1] < b[3] - 1 && a[3] > b[1] + 1));
  expect(overlaps).toEqual([]);
});

test('the Modern places button shows today’s towns and modern site names', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Feeding the five thousand');
  const button = page.getByRole('button', { name: 'Modern places' });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.map-modern').count(), { timeout: 10_000 }).toBeGreaterThan(3);
  await expect(page.locator('.map-box')).toHaveAttribute('data-modern', 'on');
  await shot(page, '12-modern-places');
  await button.click();
  await expect(page.locator('.map-modern')).toHaveCount(0);
});

test('desktop: hovering a place shows links to Wikipedia, OpenBible.info and maps', async ({ page }) => {
  test.skip(isPhone());
  await openMap(page);
  await goTo(page, 'The Samaritan woman');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /The Samaritan woman/, { timeout: 20_000 });
  // Hover once the camera has arrived, so the dot is where it will stay.
  await page.waitForFunction(() => !(window as unknown as { __jtMap: { isMoving(): boolean } }).__jtMap.isMoving(), null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const dot = (await placeDot(page, 'Sychar').locator('i').boundingBox())!;
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  const popup = page.locator('.map-popup');
  await expect(popup).toBeVisible({ timeout: 5_000 });
  await expect(popup.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Sychar');
  await expect(popup.getByRole('link', { name: 'OpenBible.info' })).toHaveAttribute('href', /openbible\.info\/geo\/ancient\//);
  await expect(popup.getByRole('link', { name: 'Google Maps' })).toBeVisible();
  // The card carries the same links for the place shown.
  await expect(page.locator('.map-card .map-links').getByRole('link', { name: 'Wikipedia' })).toBeVisible();
});

test('clicking a place pins a popup with its photo and links to the stories set there, marked on the timeline', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'A stay in Capernaum');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /A stay in Capernaum/, { timeout: 20_000 });
  await page.waitForFunction(() => !(window as unknown as { __jtMap: { isMoving(): boolean } }).__jtMap.isMoving(), null, { timeout: 15_000 });
  await placeDot(page, 'Capernaum').locator('i').click();
  const popup = page.locator('.map-popup');
  await expect(popup).toHaveClass(/pinned/, { timeout: 5_000 });
  await expect.poll(() => popup.locator('.pp-photo img').evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(popup.locator('.pp-photo figcaption a')).toHaveAttribute('href', /commons\.wikimedia\.org/);
  await expect(popup.locator('.pp-h')).toHaveText('13 stories set here');
  await expect(popup.locator('.pp-stories a[aria-current]')).toContainText('A stay in Capernaum');
  await shot(page, '13-place-popup');
  // Following a story keeps the popup open and moves the reader there.
  const story = popup.locator('.pp-stories a', { hasText: 'The temple tax' });
  await story.click();
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /The temple tax/, { timeout: 20_000 });
  await expect(popup).toBeVisible();
  await expect(story).toHaveAttribute('aria-current', 'true');
  await popup.getByRole('button', { name: 'Close' }).click();
  await expect(popup).toHaveCount(0);
});

test('a region’s popup lists the stories set in it', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Preaching in Galilee');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Preaching in Galilee/, { timeout: 20_000 });
  await page.waitForFunction(() => !(window as unknown as { __jtMap: { isMoving(): boolean } }).__jtMap.isMoving(), null, { timeout: 15_000 });
  await placeDot(page, 'Galilee').locator('span').click();
  const popup = page.locator('.map-popup');
  await expect(popup.locator('.pp-title')).toHaveText('Galilee', { timeout: 5_000 });
  await expect(popup.locator('.pp-h')).toHaveText(/\d+ stories set here/);
  await expect(popup.locator('.pp-stories a', { hasText: 'Preaching in Galilee' })).toHaveAttribute('aria-current', 'true');
  await expect(popup.locator('.pp-photo img')).toHaveAttribute('alt', /Galilee/);
  await shot(page, '14-region-popup');
});

test('desktop: dragging the divider below 20% closes the map', async ({ page }) => {
  test.skip(isPhone());
  await open(page);
  await mapChip(page).click();
  const splitter = page.getByRole('separator', { name: 'Resize the map' });
  await expect(splitter).toBeVisible({ timeout: 30_000 });
  const panes = (await page.locator('.panes').boundingBox())!;
  const s = (await splitter.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(panes.x + panes.width * 0.97, s.y + s.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(mapChip(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.cols-head .col-h')).toHaveCount(4);
});

test('chronological spacing shows estimated years', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: /^Chronological/ }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await goTo(page, 'Mk 6:35');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Feeding the five thousand, c\. AD 29/);
  await shot(page, '08-chronological');
});

test('dynamic colour tints night scenes; dark mode is available in settings', async ({ page }) => {
  await open(page);
  await goTo(page, 'Gethsemane');
  await page.waitForTimeout(1800);
  await expect(page.locator('body')).toHaveAttribute('data-tint', 'night');
  await shot(page, '06-dynamic-night');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: /^Dark/ }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('body')).toHaveAttribute('data-light', 'night');
  await shot(page, '07-dark');
});
