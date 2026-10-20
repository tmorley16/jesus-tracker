import { test } from '@playwright/test';

/** These specs were written for a phone showing one gospel at a time: start phones there (unless a test has already
 *  saved settings). tests/phone.spec.ts covers the phone's other arrangements. */
export function phonesOneAtATime() {
  test.beforeEach(async ({ page }, info) => {
    if (info.project.name !== 'phone') return;
    await page.addInitScript(() => {
      if (!localStorage.getItem('jt-reader-settings')) localStorage.setItem('jt-reader-settings', JSON.stringify({ v: 4, phoneGospels: 'one' }));
    });
  });
}
