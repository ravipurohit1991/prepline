// End-to-end verification + screenshots for Prepline.
// Drives the real UI served by the FastAPI backend on :8000.
//   node scripts/e2e_verify.mjs
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SHOTS = resolve(ROOT, 'docs', 'screenshots');
const BASE = 'http://localhost:8000';

const results = [];
const ok = (m) => { results.push(['PASS', m]); console.log('  ✓ ' + m); };
const fail = (m) => { results.push(['FAIL', m]); console.error('  ✗ ' + m); };

async function main() {
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  // ---------- 1. Library page loads with seeded recipes ----------
  const page = await context.newPage();
  await page.goto(BASE + '/');
  await page.waitForSelector('h1.page-title, h1', { timeout: 10000 });
  const recipes = await page.locator('text=Sunday Roast for Four').count().catch(() => 0);
  const recipeCount = await page.locator('a[href^="/recipes/"]').count().catch(() => 0);
  if (recipeCount > 0 || recipes > 0) ok(`Library page loaded (${recipeCount} recipe links)`);
  else fail('Library page empty');
  await page.screenshot({ path: resolve(SHOTS, 'library.png'), fullPage: true });
  ok('Saved library.png');

  // ---------- 2. Plans page -> open score ----------
  await page.goto(BASE + '/meals');
  await page.waitForLoadState('networkidle');
  const openScoreLinks = await page.locator('a:has-text("Open score")').count();
  if (openScoreLinks > 0) ok(`Plans page lists ${openScoreLinks} meal(s) with "Open score"`);
  else fail('Plans page shows no meals');

  // Get the plan id from the API to navigate deterministically.
  const planResp = await page.request.get(`${BASE}/api/plans`);
  const plansList = await planResp.json();
  const planId = plansList[0]?.id;
  if (!planId) { fail('No plans returned by API'); await browser.close(); process.exit(1); }
  await page.goto(`${BASE}/meals/${planId}`);
  await page.waitForSelector('text=Start cooking', { timeout: 10000 });
  const serveFlag = await page.locator('text=Serve').first().isVisible().catch(() => false);
  if (serveFlag || (await page.locator('text=Serve').count())) ok('Score page loaded with SERVE flag');
  else fail('Score page did not render serve');
  await page.screenshot({ path: resolve(SHOTS, 'score.png'), fullPage: true });
  ok('Saved score.png (fresh seeded plan)');
  ok('Plan id = ' + planId);

  // ---------- 3. Start cooking -> Cook page ----------
  await page.click('button:has-text("Start cooking")');
  await page.waitForURL(/\/cook\//, { timeout: 8000 });
  await page.waitForSelector('text=Service', { timeout: 10000 });
  const cookUrl = page.url();
  const sessionId = cookUrl.split('/cook/')[1];
  ok('Cook page opened, session = ' + sessionId);

  // Confirm there is a "Coming up" list with Fire buttons
  const fireButtons = await page.locator('button:has-text("Fire")').count();
  if (fireButtons > 0) ok(`Coming-up list has ${fireButtons} Fire buttons`);
  else fail('No Fire buttons on cook page');

  // ---------- 4. Fire a step ----------
  // First Fire button = first pending step
  await page.locator('button:has-text("Fire")').first().click();
  await page.waitForSelector('.step-card.running', { timeout: 8000 });
  const runningCards = await page.locator('.step-card.running').count();
  if (runningCards > 0) ok(`Fired a step -> ${runningCards} running card(s) on the fire`);
  else fail('Firing a step did not produce a running card');

  // ---------- 5. +5 min (delay) ----------
  const etaBefore = await page.locator('.eta-chip').first().innerText().catch(() => '');
  await page.locator('button:has-text("+5 min")').first().click();
  await page.waitForTimeout(1200); // ws round-trip
  ok('+5 min delay sent');

  // ---------- 6. Done ----------
  const doneButtons = await page.locator('button:has-text("Done")').count();
  if (doneButtons > 0) {
    await page.locator('button:has-text("Done")').first().click();
    await page.waitForTimeout(1000);
    ok('Done clicked for a running step');
  } else {
    fail('No Done button visible');
  }

  // ---------- 7. Undo ----------
  // Fire another step then undo to exercise reset_step
  const moreFire = await page.locator('button:has-text("Fire")').count();
  if (moreFire > 0) {
    await page.locator('button:has-text("Fire")').first().click();
    await page.waitForTimeout(800);
    const undoBtn = await page.locator('button:has-text("Undo")').count();
    if (undoBtn > 0) {
      await page.locator('button:has-text("Undo")').first().click();
      await page.waitForTimeout(800);
      ok('Undo (reset_step) exercised');
    } else fail('No Undo button after firing');
  } else ok('No more Fire buttons to undo-test (skipped)');

  await page.screenshot({ path: resolve(SHOTS, 'cook.png'), fullPage: true });
  ok('Saved cook.png (mid-service, fresh session)');

  // ---------- 8. WebSocket multi-device sync ----------
  const page2 = await context.newPage();
  const wsErrors = [];
  page2.on('console', (m) => { if (m.type() === 'error') wsErrors.push(m.text()); });
  await page2.goto(cookUrl);
  await page2.waitForSelector('text=Service', { timeout: 10000 });
  // Wait for page2's WebSocket to finish connecting (status flips to "live").
  await page2
    .locator('.eyebrow', { hasText: /live/i })
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {});
  // Both pages should report the same step progress count.
  const count = (el) => {
    const t = el;
    const m = t.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? m[1] + '/' + m[2] : t;
  };
  const header1 = count(await page.locator('.eyebrow').first().innerText());
  const header2 = count(await page2.locator('.eyebrow').first().innerText());
  if (header1 === header2) ok(`Multi-device sync: both show ${header1} steps`);
  else fail(`Multi-device headers differ: ${header1} vs ${header2}`);

  // Fire from page2, watch page1 update via WS broadcast
  const p1Before = await page.locator('button:has-text("Done")').count();
  const p2Fire = await page2.locator('button:has-text("Fire")').count();
  if (p2Fire > 0) {
    await page2.locator('button:has-text("Fire")').first().click();
    await page.waitForTimeout(1500);
    const p1After = await page.locator('button:has-text("Done")').count();
    if (p1After !== p1Before) ok('WS broadcast: page1 reacted to page2 fire');
    else fail('WS broadcast did not reach page1 (Done count unchanged)');
  } else ok('No pending Fire on page2 to test cross-broadcast (skipped)');

  // ---------- 9. Error path: delay a pending step -> 409 ----------
  // delay_step on a step that is not running is a semantic error
  // Do this via REST directly using the session.
  let got409 = false;
  try {
    // pick a pending step id from the session snapshot via API
    const snapRes = await page2.request.get(`${BASE}/api/sessions/${sessionId}`);
    const snap = await snapRes.json();
    const pending = snap.steps.find((s) => s.status === 'pending');
    if (pending) {
      const res = await page2.request.post(`${BASE}/api/sessions/${sessionId}/events`, {
        data: { type: 'delay_step', step_id: pending.step_id, minutes: 5 },
      });
      if (res.status() === 409) { got409 = true; ok(`Error path: delaying pending step -> 409 ("${(await res.json()).detail}")`); }
      else fail(`Expected 409 for delaying pending step, got ${res.status()}`);
    } else fail('No pending step available to test 409 path');
  } catch (e) {
    fail('Error-path test threw: ' + e.message);
  }
  if (!got409 && !results.some((r) => r[1].startsWith('Error path'))) {
    // already recorded above
  }

  await page2.close();
  await page.close();
  await browser.close();

  // ---------- summary ----------
  console.log('\n=== Results ===');
  const passed = results.filter((r) => r[0] === 'PASS').length;
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  for (const [s, m] of results) console.log(`${s === 'PASS' ? '✓' : '✗'} ${m}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });