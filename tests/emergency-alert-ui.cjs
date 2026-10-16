// Run with Auth/Firestore demo-closeby emulators and the development web export.
// All browser requests are restricted to loopback; no physical media is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../.verification/node_modules/playwright');
assert(process.env.FIRESTORE_EMULATOR_HOST, 'Start the isolated Firebase emulators first');
const root = path.resolve('.verification/emergency-ring-web-demo');
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
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--mute-audio'] });
    async function signup(name) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await context.addInitScript(() => {
        const OriginalAudio = window.Audio; window.emergencyAudioPlayers = [];
        window.Audio = function(source) { const audio = new OriginalAudio(source); window.emergencyAudioPlayers.push(audio); return audio; };
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
    const owner = await signup('Owner'), member = await signup('Member');
    await spaceForm(owner);
    await owner.getByLabel('Space name', { exact: true }).fill('Local emergency ring test');
    await owner.getByRole('button', { name: 'Create a space', exact: true }).click();
    const code = await owner.getByLabel('Space invitation code', { exact: true }).textContent();
    await owner.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await spaceForm(member);
    await member.getByLabel('Invitation code', { exact: true }).fill(code);
    await member.getByRole('button', { name: 'Accept invitation & join', exact: true }).click();
    await member.getByRole('button', { name: 'Share invitation link', exact: true }).waitFor();
    await member.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await member.getByRole('tab', { name: 'Settings', exact: true }).click();
    async function send(message) {
      await owner.getByRole('tab', { name: 'Safety', exact: true }).click();
      await owner.getByRole('button', { name: 'Send emergency alert', exact: true }).click();
      await owner.getByLabel('Message (optional)', { exact: true }).fill(message);
      await owner.getByRole('button', { name: 'Send emergency alert', exact: true }).last().click();
      await owner.getByRole('button', { name: 'Close dialog', exact: true }).waitFor({ state: 'hidden' });
    }
    await send('Local audible emergency check');
    await member.getByRole('button', { name: 'Dismiss emergency notification', exact: true }).waitFor();
    await member.waitForFunction(() => window.emergencyAudioPlayers[0]?.currentTime > 0.15);
    assert.equal(await member.evaluate(() => window.emergencyAudioPlayers[0].loop), true);
    assert.equal(await owner.evaluate(() => window.emergencyAudioPlayers.length), 0);
    await member.getByRole('button', { name: 'Dismiss emergency notification', exact: true }).click();
    await member.waitForFunction(() => window.emergencyAudioPlayers[0].paused && !window.emergencyAudioPlayers[0].hasAttribute('src'));
    console.log('PASS: sending an emergency rings only the recipient and dismissing the banner stops playback');
    await send('Open alert to silence');
    await member.waitForFunction(() => window.emergencyAudioPlayers[1]?.currentTime > 0.15);
    await member.getByRole('button', { name: 'View incoming emergency alert', exact: true }).click();
    await member.waitForFunction(() => window.emergencyAudioPlayers[1].paused);
    await member.getByText('Open alert to silence', { exact: true }).waitFor();
    await member.reload();
    await member.getByRole('tab', { name: 'Safety', exact: true }).click();
    await member.getByText('Open alert to silence', { exact: true }).waitFor();
    assert.equal(await member.evaluate(() => window.emergencyAudioPlayers.length), 0);
    console.log('PASS: opening an emergency stops playback, and acknowledged alerts do not ring after reopening the app');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
