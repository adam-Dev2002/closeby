// Real audio decoding/playback with a muted Chrome output; no accounts or microphones.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const ts = require('../node_modules/typescript');
const { chromium } = require('../.verification/node_modules/playwright');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const config = compile('src/lib/emergencyRing.ts'), service = compile('src/services/emergencyRing.web.ts');
const server = http.createServer((request, response) => {
  if (request.url === '/ring.wav') { response.setHeader('Content-Type', 'audio/wav'); response.end(fs.readFileSync('assets/sounds/emergency-ring.wav')); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<button id="start">Ring</button><button id="stop">Stop</button><script>
    const model={exports:{}};new Function('module','exports',${JSON.stringify(config)})(model,model.exports);
    const OriginalAudio=Audio;window.players=[];window.errors=[];
    window.Audio=function(uri){const audio=new OriginalAudio(uri);window.players.push(audio);return audio;};
    const service={exports:{}};new Function('require','module','exports',${JSON.stringify(service)})(name=>name==='../lib/emergencyRing'?model.exports:name==='expo-asset'?{Asset:{fromModule:()=>({uri:'/ring.wav'})}}:1,service,service.exports);
    let stop=()=>{};document.getElementById('start').onclick=()=>{stop();stop=service.exports.startEmergencyRing(error=>window.errors.push(error));};
    document.getElementById('stop').onclick=()=>stop();
  </script>`);
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--mute-audio'] });
    const page = await browser.newPage(); const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.click('#start');
    await page.waitForFunction(() => window.players[0]?.currentTime > 0.15);
    const result = await page.evaluate(async () => {
      const context = new AudioContext(), buffer = await context.decodeAudioData(await (await fetch('/ring.wav')).arrayBuffer());
      const samples = buffer.getChannelData(0), rms = Math.sqrt(samples.reduce((total, value) => total + value * value, 0) / samples.length);
      await context.close();
      return { duration: buffer.duration, rms, loop: window.players[0].loop, playing: !window.players[0].paused, errors: window.errors };
    });
    assert.equal(result.duration, 2); assert(result.rms > 0.05); assert(result.loop); assert(result.playing); assert.deepEqual(result.errors, []);
    await page.click('#stop'); assert(await page.evaluate(() => window.players[0].paused && !window.players[0].hasAttribute('src')));
    await page.click('#start'); await page.waitForFunction(() => window.players[1]?.currentTime > 0.15); await page.click('#stop');
    assert.deepEqual(failures, []);
    console.log('PASS: bundled ringtone decodes to non-silent samples, loops during real playback, stops and plays again cleanly');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
