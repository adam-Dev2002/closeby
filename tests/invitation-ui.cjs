// Two local browser accounts, isolated Firebase emulators, no GPS or media access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../.verification/node_modules/playwright');
assert(process.env.FIRESTORE_EMULATOR_HOST, 'Run with the demo-closeby Auth/Firestore emulators');
const pages = [], servers = [], errors = [];
function serve(directory) {
  const root = path.resolve(directory);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const route = pathname === '/' || pathname.startsWith('/j/') ? '/index.html' : pathname;
    const file = path.resolve(root, `.${route}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    response.end(fs.readFileSync(file));
  });
  servers.push(server); return server;
}
(async () => {
  let browser;
  try {
    const appServer = serve('.verification/invitations-web'), landingServer = serve('.verification/invite-hosting');
    await new Promise(resolve => appServer.listen(0, '127.0.0.1', resolve));
    await new Promise(resolve => landingServer.listen(0, '127.0.0.1', resolve));
    const appOrigin = `http://127.0.0.1:${appServer.address().port}`, landingOrigin = `http://127.0.0.1:${landingServer.address().port}`;
    const run = Date.now().toString(36);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    async function context() {
      const value = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await value.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await value.addInitScript(() => {
        window.__gpsRequests = 0; window.__sharedInvitations = [];
        navigator.geolocation.watchPosition = () => { window.__gpsRequests++; throw Error('Invitation must not start GPS'); };
        navigator.geolocation.getCurrentPosition = () => { window.__gpsRequests++; throw Error('Invitation must not start GPS'); };
        Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.__sharedInvitations.push(data); } });
      });
      return value;
    }
    async function open(value, url) {
      const page = await value.newPage(); pages.push(page); page.on('pageerror', error => errors.push(error.message));
      await page.goto(url); return page;
    }
    async function signup(page, name) {
      await page.getByRole('tab', { name: 'Sign up free', exact: true }).click();
      await page.getByLabel('Your name', { exact: true }).fill(name);
      await page.getByLabel('Email address', { exact: true }).fill(`${name.toLowerCase()}-${run}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('LocalInvitation123!');
      await page.getByRole('button', { name: 'Create free account', exact: true }).click();
      await page.getByRole('tab', { name: 'Spaces', exact: true }).waitFor();
    }
    const ownerContext = await context(), owner = await open(ownerContext, appOrigin);
    await signup(owner, 'Owner');
    await owner.getByRole('tab', { name: 'Spaces', exact: true }).click();
    await owner.getByRole('button', { name: 'Create or join a space', exact: true }).click();
    await owner.getByLabel('Space name', { exact: true }).fill('Invitation test space');
    await owner.getByRole('button', { name: 'Create a space', exact: true }).click();
    const formatted = await owner.getByLabel('Space invitation code', { exact: true }).textContent();
    assert.match(formatted, /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    const code = formatted.replaceAll('-', '');
    await owner.getByRole('button', { name: 'Share invitation link', exact: true }).click();
    const shared = await owner.evaluate(() => window.__sharedInvitations[0]);
    assert(shared.text.includes(`https://closeby-511018.web.app/j/${code}`));
    assert(shared.text.includes(formatted));
    await owner.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await owner.getByRole('button', { name: 'Invite someone to your space', exact: true }).click();
    assert.equal(await owner.evaluate(() => window.__sharedInvitations.length), 2);

    const memberContext = await context(), member = await open(memberContext, `${appOrigin}/j/${code}`);
    await member.getByText('Your space invitation is ready. Sign in or create an account to accept it.', { exact: true }).waitFor();
    await signup(member, 'Member');
    await member.getByRole('button', { name: 'Accept invitation & join', exact: true }).waitFor();
    assert.equal(await member.getByLabel('Invitation code', { exact: true }).inputValue(), formatted);
    await member.reload();
    await member.getByRole('button', { name: 'Accept invitation & join', exact: true }).waitFor();
    assert.equal(await member.getByLabel('Invitation code', { exact: true }).inputValue(), formatted);
    assert.equal(await member.evaluate(() => window.__gpsRequests), 0);
    await member.getByRole('button', { name: 'Accept invitation & join', exact: true }).click();
    await member.getByRole('button', { name: 'Share invitation link', exact: true }).waitFor();
    assert.equal(new URL(member.url()).pathname, '/', 'consuming an invitation removes it from the browser URL');
    await member.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await member.reload();
    await member.getByRole('tab', { name: 'Spaces', exact: true }).waitFor();
    assert.equal(await member.getByRole('button', { name: 'Accept invitation & join', exact: true }).count(), 0);
    assert.equal(await member.getByText('Your invitation is ready', { exact: true }).count(), 0);
    await member.goto(`${appOrigin}/j/ABCD2345WXYZ`);
    await member.getByText(/Leave that space first if you want to accept another invitation/).waitFor();
    assert.equal(await member.getByRole('button', { name: 'Accept invitation & join', exact: true }).count(), 0);
    await member.getByRole('button', { name: 'Dismiss invitation', exact: true }).click();
    await member.getByRole('button', { name: 'Close dialog', exact: true }).click();

    const landingContext = await browser.newContext({ viewport: { width: 320, height: 640 } });
    await landingContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: landingOrigin });
    const landing = await open(landingContext, `${landingOrigin}/j/${code}`);
    assert.equal(await landing.locator('#code').textContent(), formatted);
    assert.equal(await landing.getByRole('link', { name: /Open in Closeby/ }).getAttribute('href'), `closeby://join/${code}`);
    await landing.getByRole('button', { name: 'Copy invitation code' }).click();
    assert.equal(await landing.evaluate(() => navigator.clipboard.readText()), formatted);
    await landing.getByText(/Ask the person inviting you for the latest Closeby Android app/).waitFor();
    assert.equal(await landing.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await landing.screenshot({ path: '.verification/invitation-landing-320.png' });
    await landing.goto(`${landingOrigin}/j/invalid`);
    await landing.getByRole('heading', { name: 'Check your invitation.' }).waitFor();
    assert.equal(await landing.getByRole('link', { name: /Open in Closeby/ }).count(), 0);
    const androidContext = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/133.0.0.0 Mobile Safari/537.36' });
    const androidLanding = await open(androidContext, `${landingOrigin}/j/${code}`);
    assert.match(await androidLanding.locator('#open').getAttribute('href'), /^intent:\/\/join\/.+;package=com\.closeby\.tracker;/);
    for (const page of [owner, member]) assert.equal(await page.evaluate(() => window.__gpsRequests), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ shortCodes: true, nativeSharePayload: true, directInviteButton: true, linkSurvivesSignInAndReload: true,
      explicitJoin: true, existingSpaceProtected: true, clipboard: true, installFallback: true, width320: true, gpsRequests: 0, pageErrors: 0 }));
  } catch (error) {
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: `.verification/invitation-ui-failed-${i}.png` });
      console.error(`Browser ${i}: ${(await pages[i].locator('body').innerText()).slice(-2000)}`);
    }
    throw error;
  } finally { await browser?.close(); for (const server of servers) server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
