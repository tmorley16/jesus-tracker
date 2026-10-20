import { expect, test } from '@playwright/test';

// Smoke test of the exported review build (npm run export:artifact), served from a
// sub-path by scripts/serve-artifact.mjs. Run with the server going and ARTIFACT=1:
//   node scripts/serve-artifact.mjs   then   $env:ARTIFACT=1; npx playwright test tests/artifact.spec.ts
test.use({ baseURL: 'http://localhost:4400' });
test.skip(!process.env.ARTIFACT, 'needs the export server; set ARTIFACT=1');

test('the exported review build loads text and map from a sub-path', async ({ page }) => {
  const failures: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => failures.push(e.message));
  await page.goto('/review/');
  await expect(page.locator('.passage').first()).not.toHaveClass(/loading/, { timeout: 20_000 });
  // The map starts open.
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `test-results/shots/${test.info().project.name}-artifact.png` });
  expect(failures).toEqual([]);
});
