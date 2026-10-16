// Auth and Firestore emulators, two local browser accounts, synthetic GPS only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../.verification/node_modules/playwright');
assert(process.env.FIRESTORE_EMULATOR_HOST, 'Run through the demo-closeby emulators');
const root = path.resolve('.verification/location-web');
const pages = [];
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return response.writeHead(404).end();
  response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
  response.end(fs.readFileSync(file));
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`, errors = [], run = Date.now().toString(36);
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    async function signup(name, latitude, longitude) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude, longitude, accuracy: 5 } });
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      // Continuously report measured synthetic fixes without touching a real device.
      await context.addInitScript(({ latitude, longitude }) => {
        let nextWatchId = 0;
        const watches = new Map();
        navigator.geolocation.watchPosition = next => {
          const send = () => next({ timestamp: Date.now(), coords: { latitude, longitude, accuracy: 5, altitude: null, altitudeAccuracy: null, speed: 0, heading: null } });
          const watchId = ++nextWatchId;
          watches.set(watchId, setInterval(send, 3000)); setTimeout(send, 20); return watchId;
        };
        navigator.geolocation.clearWatch = id => { clearInterval(watches.get(id)); watches.delete(id); };
      }, { latitude, longitude });
      const page = await context.newPage(); pages.push(page); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      await page.getByRole('tab', { name: 'Sign up free', exact: true }).click();
      await page.getByLabel('Your name', { exact: true }).fill(name);
      await page.getByLabel('Email address', { exact: true }).fill(`${name.toLowerCase()}-${run}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('LocalGpsPassword123!');
      await page.getByRole('button', { name: 'Create free account', exact: true }).click();
      await page.getByRole('tab', { name: 'Spaces', exact: true }).waitFor();
      return page;
    }
    async function spaceForm(page) {
      await page.getByRole('tab', { name: 'Spaces', exact: true }).click();
      await page.getByRole('button', { name: 'Create or join a space', exact: true }).click();
    }
    async function selectPartner(page, name) {
      await page.getByRole('button', { name: 'View people in your space', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`^Show ${name}`) }).click();
    }
    const alice = await signup('Alice', 14.55, 121.02), bob = await signup('Bob', 14.56, 121.03);
    await spaceForm(alice);
    await alice.getByLabel('Space name', { exact: true }).fill('Local location test');
    await alice.getByRole('button', { name: 'Create a space', exact: true }).click();
    const code = await alice.getByLabel('Space invitation code', { exact: true }).textContent();
    await alice.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await spaceForm(bob);
    await bob.getByLabel('Invitation code', { exact: true }).fill(code);
    await bob.getByRole('button', { name: 'Accept invitation & join', exact: true }).click();
    await bob.getByRole('button', { name: 'Share invitation link', exact: true }).waitFor();
    await bob.getByRole('button', { name: 'Close dialog', exact: true }).click();
    for (const page of [alice, bob]) {
      await page.getByRole('tab', { name: 'Map', exact: true }).click();
      await page.getByRole('button', { name: 'Enable location', exact: true }).click();
      await page.getByText(/GPS active · Sharing paused/).waitFor();
      assert.equal(await page.getByRole('switch', { name: 'Share my location from the map' }).isChecked(), false);
    }
    await selectPartner(alice, 'Bob');
    await alice.getByText(/Ask this person to open Closeby and turn on Share my location/).waitFor();
    await alice.getByRole('switch', { name: 'Share my location from the map' }).click();
    await bob.getByRole('switch', { name: 'Share my location from the map' }).click();
    await alice.getByText('14.56000, 121.03000', { exact: true }).waitFor();
    await selectPartner(bob, 'Alice');
    await bob.getByText('14.55000, 121.02000', { exact: true }).waitFor();
    await alice.reload();
    await alice.getByRole('button', { name: 'Pause GPS', exact: true }).waitFor();
    assert.equal(await alice.getByRole('switch', { name: 'Share my location from the map' }).isChecked(), true);
    await selectPartner(alice, 'Bob');
    await alice.getByText('14.56000, 121.03000', { exact: true }).waitFor();
    await alice.screenshot({ path: '.verification/location-sharing-partner.png' });
    await alice.getByRole('button', { name: 'Pause GPS', exact: true }).click();
    await alice.reload();
    await alice.getByRole('button', { name: 'Enable location', exact: true }).waitFor();
    assert.equal(await alice.getByRole('switch', { name: 'Share my location from the map' }).isChecked(), false);
    await bob.setViewportSize({ width: 320, height: 640 });
    await bob.screenshot({ path: '.verification/location-sharing-320.png' });
    assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ bothPartnersReceiveCoordinates: true, gpsAndSharingRestoredAfterReload: true, pauseSurvivesReload: true, width320: true, pageErrors: errors.length }));
  } catch (error) {
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: `.verification/location-sharing-failed-${i}.png` });
      console.error(`Browser ${i}: ${(await pages[i].locator('body').innerText()).slice(-2500)}`);
    }
    throw error;
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
