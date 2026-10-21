import { expect, test, type Page } from '@playwright/test';
import { phonesOneAtATime } from './onePhone';

phonesOneAtATime();

const shot = (page: Page, name: string) => page.screenshot({ path: `${test.info().project.outputDir}/shots/${test.info().project.name}-${name}.png` });
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
  // The map's flight can starve that easing for seconds on the way (a phone stopped at §126 on the way to §128b),
  // which reads as still: for a title, also wait until the reading position has reached it.
  if (!/\d/.test(query)) {
    const title = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', title, { timeout: 15_000 }).catch(() => {});
  }
}

test('scrubbing the timeline moves the reader, and reading moves the playhead', async ({ page }) => {
  await open(page);
  await shot(page, '01-start');
  // It opens at the feeding of the five thousand, which all four gospels tell.
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Feeding the five thousand/);

  const box = (await page.locator('.timeline canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.waitForTimeout(900);
  const mid = await currentRow(page);
  expect(mid).toBeGreaterThan(40);
  expect(mid).toBeLessThan(170);
  await shot(page, '02-scrubbed-middle');

  // Scrolling the text moves the playhead on.
  await page.locator('.reader').evaluate((el) => { el.scrollTop += 15000; });
  await expect.poll(() => currentRow(page)).toBeGreaterThan(mid);
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

test('the map starts open beside the open gospels, with a scale, and the Map chip toggles it', async ({ page }) => {
  await open(page);
  await expect(mapChip(page)).toHaveAttribute('aria-pressed', 'true');
  await mapChip(page).click();
  await expect(page.locator('.map-pane')).toHaveCount(0);
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

test('a dark device still starts on Dynamic colours', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  await expect(page.locator('body')).toHaveAttribute('data-light', 'unstated');
  // The colours are with the gospels' settings.
  await page.getByRole('button', { name: 'Gospel settings' }).click();
  await expect(page.getByRole('group', { name: 'Colours' }).getByRole('button', { name: 'Dynamic' })).toHaveAttribute('aria-pressed', 'true');
});

test('the Timeline button hides and shows the scrubber, and remembers it', async ({ page }) => {
  test.skip(isPhone(), 'a phone always shows the timeline');
  await open(page);
  const btn = page.getByRole('button', { name: 'Timeline', exact: true });
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.timeline')).toBeVisible();
  await btn.click();
  await expect(page.locator('.timeline')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.passage').first()).not.toHaveClass(/loading/, { timeout: 20_000 });
  await expect(page.locator('.timeline')).toHaveCount(0);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.timeline')).toBeVisible();
});

test('dragging the divider past 80% leaves only the map, and the timeline still drives it', async ({ page }) => {
  await open(page);
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
  await expect.poll(() => newestLegGap(page), { timeout: 10_000 }).toBeLessThan(2);
  await page.waitForTimeout(2500);
  await shot(page, '09-likely-area');
});

test('the route goes into a region Jesus goes to, through where he waits, and turns there through a small arc', async ({ page }) => {
  await openMap(page);
  const EGYPT = [31.3075, 30.129444], BETHLEHEM = [35.207639, 31.704306], NAZARETH = [35.29769, 32.70214];
  const near = (p: number[], q: number[], km: number) => Math.hypot((p[0] - q[0]) * 96, (p[1] - q[1]) * 110.6) < km;
  const runs = (l: Leg, a: number[], b: number[]) => near(l.line[0], a, 1) && near(l.line[l.line.length - 1], b, 1);
  // In Egypt (an area 150 km about its centre): the line from Bethlehem ends inside it, where the marker waits.
  await goTo(page, 'Flight to Egypt');
  await expect.poll(async () => (await trailLegs(page)).some((l) => l.age === 0 && near(l.line[0], BETHLEHEM, 1) && near(l.line[l.line.length - 1], EGYPT, 150))).toBe(true);
  await expect.poll(() => newestLegGap(page), { timeout: 10_000 }).toBeLessThan(2);
  await page.waitForTimeout(2000);
  await shot(page, '10-egypt-leg');
  // Back to Nazareth: the newest leg runs from Bethlehem through where he waited in Egypt (not its centre), turning
  // there through a small arc, and it's already the line it will stay once he moves on.
  await goTo(page, 'From Egypt to Nazareth');
  const visit = await page.evaluate(() => {
    const route = (window as unknown as { __jtRoute: { steps: { row: number; key: string }[]; rest: Record<string, number[]> } }).__jtRoute;
    const egypt = route.steps.find((s) => s.key === 'egypt')!;
    return route.rest[`${egypt.row}:egypt`];
  });
  expect(near(visit, EGYPT, 150) && !near(visit, EGYPT, 20)).toBe(true);
  // The sharpest bend (degrees) between neighbouring stretches of a line within `km` of a point.
  const bend = (line: number[][], at: number[], km: number) => {
    let most = 0;
    for (let i = 1; i < line.length - 1; i++) {
      if (!near(line[i], at, km)) continue;
      const a = Math.atan2(line[i][1] - line[i - 1][1], line[i][0] - line[i - 1][0]), b = Math.atan2(line[i + 1][1] - line[i][1], line[i + 1][0] - line[i][0]);
      most = Math.max(most, Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI));
    }
    return most;
  };
  let travelled: number[][] = [];
  await expect.poll(async () => {
    travelled = (await trailLegs(page)).find((l) => l.age === 0 && runs(l, BETHLEHEM, NAZARETH))?.line ?? [];
    return travelled.some((p) => near(p, visit, 0.5)) && travelled.length > 4 && bend(travelled, visit, 60) < 30;
  }).toBe(true);
  await goTo(page, 'Jesus baptised');
  await expect.poll(async () => (await trailLegs(page)).some((l) => l.age > 0 && JSON.stringify(l.line) === JSON.stringify(travelled))).toBe(true);
});

test('the newest leg is drawn rounded from the start: at Sychar it is already the line it stays once he moves on', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'The Samaritan woman');
  const newest = async () => (await trailLegs(page)).find((l) => l.age === 0)?.line ?? [];
  await expect.poll(async () => (await newest()).length).toBeGreaterThan(4);
  const atSychar = await newest();
  await goTo(page, 'Welcomed in Galilee');
  await expect.poll(async () => (await trailLegs(page)).some((l) => l.age === 1 && JSON.stringify(l.line) === JSON.stringify(atSychar))).toBe(true);
});

test('setting off from an area, the line leaves from where he waits, the same however long he drifted', async ({ page }) => {
  await openMap(page);
  const toJericho = async (wait: number) => {
    await goTo(page, 'Jesus foretells his death again; James and John');
    await expect(page.locator('.map-traveller')).toHaveClass(/wandering/, { timeout: 15_000 });
    await page.waitForTimeout(wait);
    await goTo(page, 'Healing the blind near Jericho');
    await expect.poll(async () => (await trailLegs(page)).find((l) => l.age === 0)?.line.length ?? 0).toBeGreaterThan(1);
    return JSON.stringify((await trailLegs(page)).find((l) => l.age === 0)!.line);
  };
  const first = await toJericho(300);
  expect(await toJericho(3300)).toBe(first);
});

test('an area’s point is on dry land: east of the Jordan beyond it, off the lake, and the wilderness clear of the Dead Sea', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'A deaf man healed');
  // Where the route visits an area (its first visit, from the planned route), and whether a point is in one of the lakes.
  const visitAt = (key: string) => page.evaluate((key) => {
    const route = (window as unknown as { __jtRoute: { steps: { row: number; key: string }[]; rest: Record<string, number[]> } }).__jtRoute;
    const s = route.steps.find((x) => x.key === key)!;
    return route.rest[`${s.row}:${s.key}`];
  }, key);
  const inLake = (p: number[]) => page.evaluate(async (p) => {
    const lakes = await (await fetch(new URL('data/geo/lakes.json', document.baseURI))).json() as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
    const inRing = (ring: number[][]) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
      return inside;
    };
    return lakes.features.some((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).some((poly) => inRing(poly[0])));
  }, p);
  const decapolis = await visitAt('decapolis');
  expect(decapolis[0]).toBeGreaterThan(35.65); // in the hills east of the lake, not on it
  expect(await inLake(decapolis)).toBe(false);
  const beyond = await visitAt('beyond-jordan');
  expect(beyond[0]).toBeGreaterThan(35.56); // the Jordan runs at about 35.53–35.55° E there
  const wilderness = await visitAt('wilderness');
  expect(wilderness[0]).toBeLessThan(35.44); // west of the Dead Sea's north-western shore
  expect(wilderness[1]).toBeGreaterThan(31.74);
  // Every area's point is off the lakes.
  const rests = await page.evaluate(() => Object.values((window as unknown as { __jtRoute: { rest: Record<string, number[]> } }).__jtRoute.rest));
  for (const p of rests) expect(await inLake(p)).toBe(false);
});

test('where the accounts name different places, his marker waits between them and the line goes there', async ({ page }) => {
  test.skip(isPhone(), 'phones show Matthew alone, which names one place');
  await openMap(page);
  const GADARA = [35.679352, 32.655998], GERASA = [35.891397, 32.272281];
  const mid = [(GADARA[0] + GERASA[0]) / 2, (GADARA[1] + GERASA[1]) / 2];
  await goTo(page, 'Calming the storm');
  await goTo(page, 'The demon-possessed man across the lake');
  await expect(page.locator('.map-card')).toContainText('his marker waits between them');
  await expect.poll(() => page.locator('.map-traveller .wander').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect.poll(async () => {
    const end = (await trailLegs(page)).find((l) => l.age === 0)?.line.at(-1);
    return !!end && Math.hypot((end[0] - mid[0]) * 94, (end[1] - mid[1]) * 110.6) < 1;
  }).toBe(true);
  await expect.poll(() => newestLegGap(page), { timeout: 10_000 }).toBeLessThan(2);
  await page.waitForTimeout(1500);
  await shot(page, '10b-between-gadara-gerasa');
});

test('between Bethany and Jerusalem the likely area stays small, and his marker drifts only a little', async ({ page }) => {
  test.skip(isPhone(), 'phones show one gospel: in Luke alone the place named after Bethany is between Samaria and Galilee (Lk 17:11)');
  await openMap(page);
  await goTo(page, 'Teaching about prayer');
  await expect(page.locator('.map-card')).toContainText('Likely between Bethany and Jerusalem');
  await expect(page.locator('.map-traveller')).toHaveClass(/wandering/, { timeout: 15_000 });
  // How far (px) the marker is drawn from its point, over a few seconds.
  const off = () => page.evaluate(() => {
    const t = document.querySelector('.map-traveller')!.getBoundingClientRect(), s = document.querySelector('.map-traveller .sym')!.getBoundingClientRect();
    return Math.hypot(s.left + s.width / 2 - (t.left + t.width / 2), s.top + s.height / 2 - (t.top + t.height / 2));
  });
  const seen: number[] = [];
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(400); seen.push(await off()); }
  expect(Math.max(...seen)).toBeLessThan(16);
  // The places either side are further apart on screen than that.
  const at = async (name: string) => { const b = (await placeDot(page, name).locator('i').boundingBox())!; return [b.x + b.width / 2, b.y + b.height / 2]; };
  const [j, b] = [await at('Jerusalem'), await at('Bethany')];
  expect(Math.hypot(j[0] - b[0], j[1] - b[1])).toBeGreaterThan(Math.max(...seen));
});

/** Opens the reader (the map shows by default) and waits for the map to be ready. */
async function openMap(page: Page) {
  await page.goto('/?debug');
  await expect(page.locator('.passage').first()).not.toHaveClass(/loading/, { timeout: 20_000 });
  await page.waitForFunction(() => (window as unknown as { __jtMap?: { getLayer(id: string): unknown } }).__jtMap?.getLayer('arrows'), null, { timeout: 30_000 });
}
const placeDot = (page: Page, name: string) => page.locator(`.map-place:has(> span:text-is("${name}"))`);
/** The route's legs as drawn (age 0 is the newest), each as its line of points. */
type Leg = { age: number; line: number[][] };
const trailLegs = (page: Page): Promise<Leg[]> => page.evaluate(async () => {
  const map = (window as unknown as { __jtMap: { getSource(id: string): { getData(): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> } } }).__jtMap;
  return (await map.getSource('trail').getData()).features.map((f) => ({ age: f.properties!.age as number, line: f.geometry.coordinates }));
});
/** How far (px) the newest leg's end is from Jesus' marker's point (where it waits; any drift is about it); Infinity
 *  when there's no newest leg. */
const newestLegGap = (page: Page) => page.evaluate(async () => {
  type M = { getSource(id: string): { getData(): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> }; project(ll: number[]): { x: number; y: number }; getContainer(): HTMLElement };
  const map = (window as unknown as { __jtMap: M }).__jtMap;
  const newest = (await map.getSource('trail').getData()).features.find((f) => f.properties!.age === 0);
  const marker = document.querySelector('.map-traveller');
  if (!newest || !marker) return Infinity;
  const box = map.getContainer().getBoundingClientRect(), s = marker.getBoundingClientRect();
  const end = map.project(newest.geometry.coordinates[newest.geometry.coordinates.length - 1]);
  return Math.hypot(end.x - (s.left + s.width / 2 - box.left), end.y - (s.top + s.height / 2 - box.top));
});

test('a place with competing identifications lists their scores, explained in a tooltip', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Water into wine');
  await expect(page.locator('.map-card .cands span').first()).toHaveAttribute('title', /^OpenBible\.info score out of 1000/, { timeout: 15_000 });
  await expect(page.locator('.map-card .cands')).not.toContainText('1000');
  await expect(page.locator('.map-card .cands-note')).toHaveCount(0);
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
  const legs = async () => (await trailLegs(page)).map((l) => ({ ...l, from: l.line[0], to: l.line[l.line.length - 1] }));
  // Judea's end of a leg is where the route visits it (route.ts), near its centre on a trip out and back.
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
  // Home to Nazareth (Lk 1:56), then up to Bethlehem (Lk 2:4): the visit is now a loop from Nazareth out to Judea and back.
  await goTo(page, 'The birth of Jesus');
  await expect.poll(async () => {
    const l = await legs();
    return l.some((x) => x.age === 1 && at(x.from, NAZARETH) && at(x.to, NAZARETH) && x.line.some((p) => at(p, JUDEA, IN_JUDEA))) && l.some((x) => x.age === 0 && at(x.from, NAZARETH) && at(x.to, BETHLEHEM));
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

test('in an area the traveller waits where the route passes through it and drifts; at a named place it stands still', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Preaching through Galilee');
  await expect(page.locator('.map-traveller')).toHaveClass(/wandering/, { timeout: 8_000 });
  await expect(page.locator('.map-traveller')).not.toHaveClass(/\boff\b/);
  // A tour within the region he is already in still gets its line, to where the marker waits.
  await expect.poll(() => newestLegGap(page), { timeout: 10_000 }).toBeLessThan(2);
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
  // MapLibre sets each marker's opacity inline, so hiding works on the inner element: once he is born, a little glow
  // stays while he rests in a scene he isn't in, and a little of his light on the land...
  const shown = (sel: string) => page.locator(`${sel} .wander`).evaluate((el) => getComputedStyle(el).opacity);
  const strength = () => page.evaluate(() => (window as unknown as { __jtMap: { getLayer(id: string): { implementation?: { status(): { strength: number } } } | undefined } }).__jtMap.getLayer('land-light')!.implementation!.status().strength);
  await goTo(page, 'John the Baptist preaches');
  await expect.poll(() => shown('.map-traveller-glow')).toBe('0.45');
  expect(await shown('.map-traveller')).toBe('1');
  await expect.poll(strength).toBeGreaterThan(0.3);
  expect(await strength()).toBeLessThan(0.4);
  // ...but none before (phones show one gospel, Matthew first, so they open on a different scene).
  if (isPhone()) return;
  await goTo(page, 'An angel appears to Joseph');
  await expect.poll(() => shown('.map-traveller-glow')).toBe('0');
  await expect.poll(strength).toBeLessThan(0.05);
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
  // In an area the light grows to cover it, in place of the shaded circle.
  await goTo(page, 'Flight to Egypt');
  await expect.poll(async () => (await light()).cover, { timeout: 10_000 }).toBeGreaterThan(0.95);
  expect(await circle()).toBe(0);
  await shot(page, '16-light-egypt');
  // Switched off in Settings (on a phone, Effects): no light, and the shaded circle is back.
  await page.getByRole('button', { name: 'Map layers and credits' }).click();
  await page.getByRole('button', { name: 'Effects' }).click();
  await page.keyboard.press('Escape');
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

test('the Mountains button is on where the text places Jesus on a mountain; it hides them there, or shows them anywhere', async ({ page }) => {
  await openMap(page);
  const button = page.getByRole('button', { name: 'Mountains', exact: true });
  // The map's toggles are behind its layers button.
  const ensure = async () => { if (!(await button.isVisible())) await page.getByRole('button', { name: 'Map layers and credits' }).click(); };
  const lit = () => page.evaluate(() => (window as unknown as { __jtMap: { getLayer(id: string): { implementation?: { status(): { mountain: number } } } | undefined } }).__jtMap.getLayer('land-light')!.implementation!.status().mountain);
  await goTo(page, 'The transfiguration');
  await ensure(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.map-peak')).toHaveCount(3);
  await expect.poll(lit).toBeGreaterThan(0.9);
  // Turned off there: no peaks, and no light on them.
  await ensure(); await button.click();
  await ensure(); await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.map-peak')).toHaveCount(0);
  await expect(page.locator('.map-card')).toContainText('mountains hidden');
  await expect.poll(lit).toBeLessThan(0.05);
  // Elsewhere it starts off; turned on, every named mountain is marked, but not lit.
  await page.keyboard.press('Escape'); // the layers panel's backdrop would take the tap
  await goTo(page, 'Calming the storm');
  await ensure(); await expect(button).toHaveAttribute('aria-pressed', 'false');
  await ensure(); await button.click();
  await ensure(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.map-peak').count()).toBeGreaterThan(3);
  await expect.poll(lit).toBeLessThan(0.05);
});

test('in an area Jesus’ marker drifts a little about where the newest leg ends', async ({ page }) => {
  await openMap(page);
  await goTo(page, 'Flight to Egypt');
  await expect(page.locator('.map-traveller')).toHaveClass(/wandering/, { timeout: 15_000 });
  type M = { getSource(id: string): { getData(): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> }; project(ll: number[]): { x: number; y: number }; getContainer(): HTMLElement };
  // Where the marker is drawn (px), and how far that is from the newest leg's end.
  const measure = () => page.evaluate(async () => {
    const map = (window as unknown as { __jtMap: M }).__jtMap;
    const newest = (await map.getSource('trail').getData()).features.find((f) => f.properties!.age === 0)!.geometry.coordinates;
    const box = map.getContainer().getBoundingClientRect(), s = document.querySelector('.map-traveller .sym')!.getBoundingClientRect();
    const x = s.left + s.width / 2 - box.left, y = s.top + s.height / 2 - box.top, end = map.project(newest[newest.length - 1]);
    return { x, y, gap: Math.hypot(end.x - x, end.y - y) };
  });
  const seen: { x: number; y: number; gap: number }[] = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); seen.push(await measure()); }
  // It drifts, but only a little: the line ends where he waits, and he's never far from it.
  expect(Math.max(...seen.map((m) => Math.hypot(m.x - seen[0].x, m.y - seen[0].y)))).toBeGreaterThan(1.5);
  expect(Math.max(...seen.map((m) => m.gap))).toBeLessThan(16);
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
  // The map's toggles are behind its layers button.
  const ensure = async () => { if (!(await button.isVisible())) await page.getByRole('button', { name: 'Map layers and credits' }).click(); };
  await ensure(); await button.click();
  await ensure(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.map-modern').count(), { timeout: 10_000 }).toBeGreaterThan(3);
  await expect(page.locator('.map-box')).toHaveAttribute('data-modern', 'on');
  await shot(page, '12-modern-places');
  await ensure(); await button.click();
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
});

test('desktop: clicking a place opens the place card with its photo and the stories set there, marked on the timeline', async ({ page }) => {
  test.skip(isPhone(), 'phones have their own card (phone.spec)');
  await openMap(page);
  await goTo(page, 'A stay in Capernaum');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /A stay in Capernaum/, { timeout: 20_000 });
  await page.waitForFunction(() => !(window as unknown as { __jtMap: { isMoving(): boolean } }).__jtMap.isMoving(), null, { timeout: 15_000 });
  await placeDot(page, 'Capernaum').locator('i').click();
  const card = page.locator('.map-card');
  await expect(card).toHaveAttribute('data-open', '', { timeout: 5_000 });
  await expect(page.locator('.map-popup.pinned')).toHaveCount(0);
  await expect.poll(() => card.locator('.mc-img img').evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(card.locator('.mc-credit')).toHaveAttribute('href', /commons\.wikimedia\.org/);
  await expect(card.locator('.mc-credit')).toHaveText('Photo: AVRAMGR');
  await expect(card.locator('.pp-stories li')).toHaveCount(13);
  await expect(card.locator('.pp-stories a[aria-current]')).toContainText('A stay in Capernaum');
  await page.waitForTimeout(400);
  await shot(page, '13-place-card');
  // Following a story moves the reader there, the card still open.
  const story = card.locator('.pp-stories a', { hasText: 'The temple tax' });
  await story.click();
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /The temple tax/, { timeout: 20_000 });
  await expect(card.locator('.pp-stories a[aria-current]')).toContainText('The temple tax');
  // Less, from the chevron under the fold.
  await card.getByRole('button', { name: 'Show less' }).click();
  await expect(card.locator('.pp-stories')).toHaveCount(0);
});

test('desktop: a region’s name opens the card with the stories set in it', async ({ page }) => {
  test.skip(isPhone(), 'phones have their own card (phone.spec)');
  await openMap(page);
  await goTo(page, 'Preaching in Galilee');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Preaching in Galilee/, { timeout: 20_000 });
  await page.waitForFunction(() => !(window as unknown as { __jtMap: { isMoving(): boolean } }).__jtMap.isMoving(), null, { timeout: 15_000 });
  // Moving over the area itself, away from its name, shows nothing: only the name opens the popup.
  const name = (await placeDot(page, 'Galilee').locator('span').boundingBox())!;
  await page.mouse.move(name.x + name.width / 2, name.y + name.height + 50);
  await page.waitForTimeout(600);
  await expect(page.locator('.map-popup')).toHaveCount(0);
  await placeDot(page, 'Galilee').locator('span').click();
  const card = page.locator('.map-card');
  await expect(card.locator('.mc-cap .map-title')).toHaveText('Galilee', { timeout: 5_000 });
  await expect(card.locator('.pp-stories li')).not.toHaveCount(0);
  await expect(card.locator('.pp-stories a', { hasText: 'Preaching in Galilee' })).toHaveAttribute('aria-current', 'true');
  await expect(card.locator('.mc-img img')).toHaveAttribute('alt', /Galilee/);
  await shot(page, '14-region-card');
});

test('desktop: dragging the divider below 20% closes the map', async ({ page }) => {
  test.skip(isPhone());
  await open(page);
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

test('the timeline’s Time switch shows estimated years, and Text switches back', async ({ page }) => {
  await open(page);
  // The scale is in the timeline's settings.
  const settings = () => page.getByRole('button', { name: 'Timeline settings' }).click();
  const done = () => page.keyboard.press('Escape');
  await settings();
  const years = page.getByRole('group', { name: 'Timeline scale' }).getByRole('button', { name: 'Time' });
  await expect(years).toHaveAttribute('aria-pressed', 'false');
  await years.click();
  await expect(years).toHaveAttribute('aria-pressed', 'true');
  await done();
  await goTo(page, 'Mk 6:35');
  await expect(page.locator('.timeline-track')).toHaveAttribute('aria-valuetext', /Feeding the five thousand, c\. AD 29/);
  await shot(page, '08-chronological');
  await settings();
  await page.getByRole('group', { name: 'Timeline scale' }).getByRole('button', { name: 'Text' }).click();
  await expect(years).toHaveAttribute('aria-pressed', 'false');
  await done();
  // A phone always shows the timeline.
  if (isPhone()) await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toHaveCount(0);
});

test('dynamic colour tints night scenes; dark mode is available in settings', async ({ page }) => {
  await open(page);
  await goTo(page, 'Gethsemane');
  await page.waitForTimeout(1800);
  await expect(page.locator('body')).toHaveAttribute('data-tint', 'night');
  await shot(page, '06-dynamic-night');
  await page.getByRole('button', { name: 'Gospel settings' }).click();
  await page.getByRole('group', { name: 'Colours' }).getByRole('button', { name: 'Dark' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  await expect(page.locator('body')).toHaveAttribute('data-light', 'night');
  await shot(page, '07-dark');
});

/** Scrolls the reader so a verse of a gospel sits just past the reading line. */
async function readVerse(page: Page, book: string, cv: string) {
  await page.evaluate(([book, cv]) => {
    const s = document.querySelector<HTMLElement>('.reader')!;
    const el = document.querySelector<HTMLElement>(`.cell[data-book="${book}"] [data-cv="${cv}"]`)!;
    const head = document.querySelector<HTMLElement>('.cols-head')?.offsetHeight ?? 0;
    const line = s.getBoundingClientRect().top + head + (s.clientHeight - head) * 0.22;
    s.scrollTop += el.getBoundingClientRect().top - line + 4;
  }, [book, cv]);
}

test('desktop: the light changes as the text does within a passage (Mk 1:35 dark, daybreak, then day)', async ({ page }) => {
  test.skip(isPhone());
  await open(page);
  await goTo(page, 'Mk 1:35');
  await expect(page.locator('body')).toHaveAttribute('data-tint', 'predawn');
  await readVerse(page, 'MRK', '1:36');
  await expect(page.locator('body')).toHaveAttribute('data-tint', 'dawn');
  await readVerse(page, 'MRK', '1:39');
  await expect(page.locator('body')).toHaveAttribute('data-tint', 'day');
  await goTo(page, 'The bread and the cup');
  await expect(page.locator('body')).toHaveAttribute('data-tint', 'night');
});

test('from his death until the angel at the tomb, the colours turn cold and his glow goes out', async ({ page }) => {
  await open(page);
  await goTo(page, 'The burial');
  await expect(page.locator('body')).toHaveAttribute('data-dead', '');
  await expect(page.locator('body')).toHaveAttribute('data-tint', 'dead');
  await expect(page.locator('.map-traveller-glow .wander')).toHaveCSS('opacity', '0');
  await page.waitForTimeout(1500);
  await shot(page, '15-dead');
  await goTo(page, 'The earthquake');
  await expect(page.locator('body')).not.toHaveAttribute('data-dead', '');
  await expect(page.locator('body')).toHaveAttribute('data-tint', 'dawn');
});

test('the timeline keeps its full width, with the scale in the toolbar and a way back from zooming in', async ({ page }) => {
  await open(page);
  // Desktops: the timeline's full width but for its settings button, and no scale switch in the toolbar. (Phones
  // have the gospels and tools beside it.)
  if (!isPhone()) {
    const width = () => page.locator('.timeline canvas').evaluate((c) => c.getBoundingClientRect().width);
    const full = await page.locator('.timeline').evaluate((t) => t.clientWidth - 16 - 36);
    expect(await width()).toBeGreaterThan(full - 4);
    await expect(page.locator('.toolbar').getByRole('group', { name: 'Timeline scale' })).toHaveCount(0);
  }
  // Zooming in brings a way back to the whole timeline.
  await expect(page.getByRole('button', { name: 'Show the whole timeline' })).toHaveCount(0);
  await page.locator('.timeline-track').focus();
  await page.keyboard.press('+');
  await page.getByRole('button', { name: 'Show the whole timeline' }).click();
  await expect(page.getByRole('button', { name: 'Show the whole timeline' })).toHaveCount(0);
  await shot(page, '16-controls');
  // A phone has no toolbar, and no way to hide the timeline.
  if (isPhone()) {
    await expect(page.locator('.toolbar')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toHaveCount(0);
  }
});

test('a section no gospel narrates (the appearance to James, §182) can be picked from Go to without losing the reader', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  if (test.info().project.name === 'phone') await page.getByRole('button', { name: 'Go to a passage or event' }).click();
  await page.locator('#goto').fill('James');
  await page.getByRole('option').filter({ hasText: '§182' }).click();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
  await expect(page.locator('.cols-head')).toBeVisible();
  await expect(page.locator('.passage').first()).toBeVisible();
});

test('desktop: each area has its own settings button, and × hides a gospel', async ({ page }) => {
  test.skip(isPhone(), 'phone.spec covers the phone arrangements');
  await openMap(page);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  for (const name of ['Timeline settings', 'Gospel settings', 'Map layers and credits']) await expect(page.getByRole('button', { name })).toBeVisible({ timeout: 30_000 });
  // The timeline's: the feasts and the time of day switch off.
  await page.getByRole('button', { name: 'Timeline settings' }).click();
  const marks = page.getByRole('button', { name: 'Feasts and time of day' });
  await expect(marks).toHaveAttribute('aria-pressed', 'true');
  await marks.click();
  await expect(marks).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  // The gospels' stay side by side: no layout or shrinking on a desktop.
  await page.getByRole('button', { name: 'Gospel settings' }).click();
  await expect(page.getByRole('group', { name: 'Layout' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shrink missing' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The map's: Terrain and Trail switches, both on to begin with.
  await page.getByRole('button', { name: 'Map layers and credits' }).click();
  const terrain = page.getByRole('button', { name: 'Terrain' }), trail = page.getByRole('button', { name: 'Trail' });
  await expect(terrain).toHaveAttribute('aria-pressed', 'true');
  await terrain.click();
  await expect(page.locator('.map-box')).toHaveAttribute('data-land', 'plain');
  await expect(trail).toHaveAttribute('aria-pressed', 'true');
  await trail.click();
  const vis = () => page.evaluate(() => (window as unknown as { __jtMap: { getLayoutProperty(id: string, p: string): string | undefined } }).__jtMap.getLayoutProperty('trail-old', 'visibility'));
  await expect(trail).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(vis).toBe('none');
  await page.waitForTimeout(300);
  await shot(page, '17-desktop-settings');
  await page.keyboard.press('Escape');
  // An × in a gospel's heading hides it.
  await page.getByRole('button', { name: 'Hide John' }).click();
  await expect(page.locator('.cols-head .col-h')).toHaveCount(3);
});

test('desktop: with the text beside the map, the card gives the place and its stories, the headings no place chip', async ({ page }) => {
  test.skip(isPhone(), 'phones have their own card');
  await openMap(page);
  await goTo(page, 'The Samaritan woman');
  const card = page.locator('.map-card');
  await expect(card).toHaveAttribute('data-lean', '');
  await expect(card.locator('.kicker')).toHaveCount(0);
  await expect(card.locator('.map-title')).toHaveText('Sychar', { timeout: 15_000 });
  await expect(card.locator('.pp-stories')).toHaveCount(0);
  await card.locator('.mc-expand').click();
  await expect(card.locator('.pp-stories li').first()).toBeVisible();
  await expect(card.locator('.pp-stories a[aria-current]')).toContainText('Samaritan');
  await expect(page.locator('section.row .chip.place').first()).toBeHidden();
  await shot(page, '18-lean-card');
  // A place with a photo, still open: its name, links and the photographer's credit over it.
  await goTo(page, 'Feeding the five thousand');
  await expect(card.locator('.mc-img img')).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('.mc-cap .map-title')).toHaveText('Bethsaida');
  await expect(card.locator('.mc-links').getByRole('link', { name: 'Wikipedia' })).toBeVisible();
  await expect(card.locator('.mc-credit')).toContainText('Photo');
  await shot(page, '18-lean-card-photo');
  // Folded away into a tab with the place's name, and back.
  await card.getByRole('button', { name: 'Fold the place card away' }).click();
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: 'Show the place card' }).click();
  await expect(card).toBeVisible();
  // Hidden gospels' sections kept on the timeline, faded: the layout no longer changes with the gospels shown.
  await page.getByRole('button', { name: 'Timeline settings' }).click();
  await page.getByRole('group', { name: 'Hidden gospels' }).getByRole('button', { name: /faded/ }).click();
  await page.keyboard.press('Escape');
  // With only the map, the card gives the story too.
  for (const n of ['Matthew', 'Mark', 'Luke', 'John']) await page.locator('.toolbar .gospels').getByRole('button', { name: n }).click();
  await expect(card).not.toHaveAttribute('data-lean', '');
  await expect(card.locator('.map-title')).toHaveText(/Feeding the five thousand/);
});
