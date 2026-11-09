import { test, expect } from '@playwright/test';

// Core-loop states and the B-1 path check (M6). The env-gated tests need the
// recording stub, the fixture library or a stopped Strapi — see the M6 spec.

test('a malformed documentId renders the route error instead of fetching', async ({ page }) => {
  await page.goto('/video/NOT-A-DOCUMENT-ID');
  await expect(page.getByTestId('route-error')).toBeVisible();
});

test('a traversal documentId never reaches Strapi', async ({ page }) => {
  await page.goto('/video/..%2F..%2Fusers%2F1');
  await expect(
    page.getByTestId('route-error').or(page.getByText("That video isn't here.")).first(),
  ).toBeVisible();
});

test('/learn for a video not in the library shows the unshared state', async ({ page }) => {
  await page.goto('/learn/zzzzzzzzzz0');
  await expect(page.getByText("This video isn't in the knowledge base yet.")).toBeVisible();
});

test('/new-post shows a failed share inline', async ({ page }) => {
  test.skip(process.env.E2E_STRAPI_WRITES_FAIL !== '1', 'needs the recording stub');
  test.setTimeout(60_000);
  await page.goto('/new-post');
  // R-E8-4: on the dev server the client hydrates after `load`; a click
  // before that submits the form natively and reloads the page. Wait until
  // React owns the URL input. (`networkidle` never settles here: the
  // TanStack devtools keep an SSE request open.)
  await page.waitForFunction(() => {
    const input = document.querySelector('input#url');
    return !!input && Object.keys(input).some((k) => k.startsWith('__reactProps'));
  });
  await page.getByLabel('YouTube URL').fill('https://www.youtube.com/watch?v=zzzzzzzzzz0');
  await page.getByRole('button', { name: 'Share video' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Not Found' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Share video' })).toBeEnabled();
});

test('/settings score refresh reports the rows it skipped', async ({ page }) => {
  test.skip(process.env.E2E_FIXTURES !== '1', 'needs the M6 fixture library');
  await page.goto('/settings');
  await expect(page.getByText(/6 videos need updating/)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh scores' }).click();
  await expect(page.getByText(/Updated 3 final scores\./)).toBeVisible();
  await expect(page.getByText(/3 videos skipped — no cached transcript/)).toBeVisible();
});

test.describe('with Strapi down', () => {
  test.skip(process.env.E2E_STRAPI_DOWN !== '1', 'stop Strapi first');
  test('/learn shows the backend error panel', async ({ page }) => {
    await page.goto('/learn/zzzzzzzzzz0');
    await expect(page.getByText("Can't reach Strapi.")).toBeVisible();
  });
  test('/settings says the counts could not be read', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/Couldn.t check the library/)).toBeVisible();
  });
});
