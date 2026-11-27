// Wait, outside any test's budget, until a freshly launched browser can actually
// paint a page: open a throwaway page and resolve after two animation frames.
//
// Why (B54, #96): on cold windows-checks runners the first page of each of the
// three browser files that start together got no usable frames for >30 s, so
// whatever that first test waited on first timed out (runs 45872405970 and
// 45811947021: metre-sidebar waitForFunction, tool-images locator.waitFor,
// metre-switch waiting for the Virtuoso radio that is painted from a
// requestAnimationFrame), while every later page in the same browser took ~1 s.
// Launch alone was already outside the budget; the first paint was not.
// This waits for that explicit condition instead of widening any timeout.
export async function waitFirstFrame(browser, label) {
  const started = Date.now();
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><meta charset="utf-8"><p>warm</p>');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally {
    await page.close();
  }
  console.log(`ℹ ${label}: first page painted ${Date.now() - started} ms after launch`);
}
