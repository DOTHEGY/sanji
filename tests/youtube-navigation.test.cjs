const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const source = fs.readFileSync('private/ui/app.js', 'utf8');
const declarations = source.slice(source.indexOf('const routes ='), source.indexOf('const statuses ='));
const renderSource = source.slice(source.indexOf('function render() {'), source.indexOf('function dashboardExistingSummary('));

function navigation(available, key = 'creators', signedIn = true) {
  const nav = { innerHTML: '' }, breadcrumb = {};
  const context = {
    YOUTUBE_DISCOVERY_AVAILABLE: available,
    location: { hash: '#' + key }, me: signedIn ? { id: 'fixture-owner' } : null,
    manualNotesView: null, inboxRequestGeneration: 0, inboxLifecycle: 'active',
    catalogSheetSettingsDispose() {}, inboxNotesDispose() {}, dashboard() {},
    pages: {}, $: selector => selector === '#nav' ? nav : breadcrumb,
  };
  vm.createContext(context);
  vm.runInContext(declarations + renderSource + ';render();', context);
  return { html: nav.innerHTML, context, nav };
}

test('YouTube entry belongs to the creator group and opens the separate page safely', () => {
  const { html } = navigation(true);
  const group = html.match(/<div class="nav-group" role="group" aria-label="크리에이터">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group);
  assert.match(group, /href="#creators"/);
  assert.match(group, /href="#matching"/);
  assert.match(group, /href="\.\/youtube\/" target="_blank" rel="noopener"/);
  assert.match(group, /aria-label="유튜브 크리에이터 검색 \(새 탭\)"/);
  assert.equal((html.match(/href="\.\/youtube\/"/g) || []).length, 1);
  assert.doesNotMatch(html, /href="#youtube"|data-action=".*youtube|access_token/);
});

test('alternative Node workspace and signed-out rendering do not expose an unsupported entry', () => {
  assert.match(source, /const YOUTUBE_DISCOVERY_AVAILABLE = false;/);
  assert.doesNotMatch(navigation(false).html, /href="\.\/youtube\/"/);
  assert.equal(navigation(true, 'dashboard', false).html, '');
});

test('repeated route rendering keeps one entry and existing active links', () => {
  const { context, nav } = navigation(true);
  context.location.hash = '#inbox';
  vm.runInContext('render();render();', context);
  assert.equal((nav.innerHTML.match(/href="\.\/youtube\/"/g) || []).length, 1);
  assert.match(nav.innerHTML, /href="#inbox" class="active" aria-current="page"/);
  assert.match(nav.innerHTML, /href="#creators" class=""/);
});

test('Supabase build opts in explicitly and publishes the existing target page', () => {
  const build = fs.readFileSync('scripts/build-supabase.cjs', 'utf8');
  assert.match(build, /YouTube navigation capability marker missing/);
  assert.match(build, /source\.replace\("const YOUTUBE_DISCOVERY_AVAILABLE = false;", "const YOUTUBE_DISCOVERY_AVAILABLE = true;"\)/);
  const bundle = fs.readFileSync('public/workspace/app.js', 'utf8');
  assert.match(bundle, /href="\.\/youtube\/"/);
  assert.match(bundle, /target="_blank" rel="noopener"/);
  assert.match(fs.readFileSync('public/workspace/youtube/index.html', 'utf8'), /SANJI · YouTube 크리에이터 탐색/);
  const crypto = require('node:crypto');
  const hash = crypto.createHash('sha256').update(bundle).digest('hex').slice(0, 12);
  assert.ok(fs.readFileSync('public/workspace/index.html', 'utf8').includes('app.js?v=' + hash));
});

function navigationFixture(css) {
  // Match the real workspace's UTF-8/standards-mode document. Without an
  // encoding declaration, Chromium can decode Korean accessible names as
  // Windows-1252 and the exact link locator never resolves.
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><aside><nav id="nav">' + navigation(true).html + '</nav></aside><main><label>작성 중인 초안<textarea id="draft">저장 전 초안</textarea></label></main>';
}

test('navigation fixture declares UTF-8 before styles and Korean accessible names', () => {
  const html = navigationFixture('/* synthetic styles */');
  assert.match(html, /^<!doctype html><meta charset="utf-8">/);
  assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf('<style>'));
  assert.match(html, /aria-label="유튜브 크리에이터 검색 \(새 탭\)"/);
});

test('desktop and mobile open the search page in a separate tab without losing the working draft', async () => {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let server;
  try {
    const css = fs.readFileSync('private/ui/style.css', 'utf8');
    // Exercise the real rendered navigation and published target HTML without a live account or API.
    const target = fs.readFileSync('public/workspace/youtube/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    const main = navigationFixture(css);
    server = http.createServer((req, res) => {
      const isTarget = req.url.split('?')[0] === '/sanji/workspace/youtube/';
      res.setHeader('Content-Type', req.url.includes('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(req.url.includes('.css') ? fs.readFileSync('public/workspace/youtube/style.css') : isTarget ? target : main);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 850 } });
      try {
        const page = await context.newPage();
        await page.goto(base + '/sanji/workspace/#creators');
        assert.equal(await page.evaluate(() => document.characterSet), 'UTF-8');
        assert.equal(await page.locator('#nav a[href="./youtube/"]').getAttribute('aria-label'), '유튜브 크리에이터 검색 (새 탭)');
        const link = page.getByRole('link', { name: '유튜브 크리에이터 검색 (새 탭)', exact: true });
        await link.scrollIntoViewIfNeeded();
        assert.ok(await link.isVisible());
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (let repeat = 0; repeat < 2; repeat++) {
          const popupPromise = context.waitForEvent('page');
          await link.click();
          const popup = await popupPromise;
          await popup.waitForLoadState();
          assert.equal(popup.url(), base + '/sanji/workspace/youtube/');
          assert.equal(await popup.getByRole('heading', { name: '함께할 크리에이터를 찾아보세요' }).count(), 1);
          assert.equal(await popup.evaluate(() => window.opener), null);
          assert.equal(page.url(), base + '/sanji/workspace/#creators');
          assert.equal(await page.locator('#draft').inputValue(), '저장 전 초안');
          await popup.close();
        }
        await page.getByRole('link', { name: '상품 매칭', exact: true }).click();
        assert.equal(new URL(page.url()).hash, '#matching');
        await page.goBack();
        assert.equal(new URL(page.url()).hash, '#creators');
        await page.goForward();
        assert.equal(new URL(page.url()).hash, '#matching');
        assert.equal(await page.locator('#draft').inputValue(), '저장 전 초안');
        await page.screenshot({ path: path.resolve('../youtube-navigation-' + width + '.png') });
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
