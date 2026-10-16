// Run with Auth/Firestore demo-closeby emulators and the development web export.
// All browser requests are restricted to loopback; no physical media is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../.verification/node_modules/playwright');
assert(process.env.FIRESTORE_EMULATOR_HOST, 'Start the isolated Firebase emulators first');
const root = path.resolve('.verification/call-fix-web-dev');
const server = http.createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, `.${name === '/' ? '/index.html' : name}`);
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
    async function signup(name) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await context.addInitScript(() => {
        window.captureCount = 0;
        navigator.mediaDevices.getUserMedia = async () => { window.captureCount++; throw new Error('This test never approves capture'); };
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      await page.getByRole('tab', { name: 'Sign up free', exact: true }).click();
      await page.getByLabel('Your name', { exact: true }).fill(name);
      await page.getByLabel('Email address', { exact: true }).fill(`${name.toLowerCase()}-${run}@example.test`);
      await page.getByLabel('Password', { exact: true }).fill('LocalCallPassword123!');
      await page.getByRole('button', { name: 'Create free account', exact: true }).click();
      await page.getByRole('tab', { name: 'Spaces', exact: true }).waitFor();
      return page;
    }
    async function spaceForm(page) {
      await page.getByRole('tab', { name: 'Spaces', exact: true }).click();
      await page.getByRole('button', { name: 'Create or join a space', exact: true }).click();
    }
    async function accessSheet(page) {
      await page.getByRole('tab', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Camera & microphone requests', exact: true }).click();
    }
    const owner = await signup('Owner'), member = await signup('Member');
    await spaceForm(owner);
    await owner.getByLabel('Space name', { exact: true }).fill('Local call popup test');
    await owner.getByRole('button', { name: 'Create a space', exact: true }).click();
    const code = await owner.getByLabel('Space invitation code', { exact: true }).textContent();
    await owner.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await spaceForm(member);
    await member.getByLabel('Invitation code', { exact: true }).fill(code);
    await member.getByRole('button', { name: 'Accept invitation & join', exact: true }).click();
    await member.getByRole('button', { name: 'Share invitation link', exact: true }).waitFor();
    await member.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await accessSheet(member);
    for (const [request, approval] of [['Request microphone', 'Approve microphone once'], ['Request front camera + mic', 'Approve front camera + mic once'], ['Request rear camera + mic', 'Approve rear camera + mic once']]) {
      await accessSheet(owner);
      await owner.getByRole('button', { name: request, exact: true }).click();
      await member.getByRole('button', { name: approval, exact: true }).waitFor();
      assert.equal(await member.getByRole('dialog').count(), 1, 'Only one modal presents the approval over the open sheet');
      assert.equal(await member.locator('iframe').count(), 0);
      assert.equal(await member.evaluate(() => window.captureCount), 0);
      assert.equal(await owner.evaluate(() => window.captureCount), 0);
      if (request === 'Request front camera + mic') await member.screenshot({ path: '.verification/call-member-approval.png' });
      await member.getByRole('button', { name: 'Decline', exact: true }).click();
      await owner.getByText('The other person declined your call.', { exact: true }).waitFor();
      await owner.getByRole('button', { name: 'Dismiss message', exact: true }).click();
      await member.getByText('Camera & microphone', { exact: true }).waitFor();
      console.log(`PASS: ${request} displays recipient approval over an open sheet, and decline captures no media`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
