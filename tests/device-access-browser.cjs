// Local WebRTC integration with Chrome fake media only; no Firebase or hardware.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { chromium } = require('../.verification/node_modules/playwright');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => dependencies[name] });
  return module.exports;
}
const calls = load('src/lib/calls.ts'), media = load('src/lib/callMediaHtml.ts', { './calls': calls });
let origin;
const server = http.createServer((_request, response) => {
  const documents = {};
  for (const access of ['microphone', 'front', 'back']) for (const role of ['caller', 'callee']) {
    let html = media.callMediaHtml({ channel: role, role, access, mode: access === 'microphone' ? 'voice' : 'video', iceServers: [], parentOrigin: origin });
    // Chrome's fake webcam has no front/rear setting. This hardware shim records
    // the exact requested constraint and labels that fake webcam accordingly.
    // The WebRTC negotiation, packets, frames, and track cleanup remain real.
    const shim = `<script>
      window.captureCount=0;window.captureConstraints=[];
      const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async constraints=>{
        window.captureCount++;window.captureConstraints.push(constraints);
        const facing=constraints.video&&constraints.video.facingMode&&constraints.video.facingMode.exact;
        const stream=await capture({...constraints,video:constraints.video?{...constraints.video,facingMode:undefined}:false});
        for(const track of stream.getVideoTracks()){const settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),facingMode:facing});}
        return stream;
      };
    </script>`;
    html = html.replace('<script>', `${shim}<script>`);
    documents[`${access}/${role}`] = html;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><html><body><main id="frames" style="display:flex;height:400px"></main><script>
    const documents=${calls.mediaJson(documents)}, states={}, descriptions={}, candidates={caller:[],callee:[]};let sequence=0;
    window.start=access=>{for(const role of ['caller','callee']){const frame=document.createElement('iframe');frame.id=role;frame.allow='camera; microphone; autoplay';frame.srcdoc=documents[access+'/'+role];document.getElementById('frames').appendChild(frame);}};
    window.update=(role,command)=>document.getElementById(role).contentWindow.postMessage({channel:role,...command},location.origin);
    window.addEventListener('message',event=>{
      const value=event.data,role=value&&value.channel,frame=role&&document.getElementById(role);
      if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;
      if(value.type==='error'){states.error=value.message;return;}if(value.type==='state')states[role]=value.state;
      if(value.type==='offer'||value.type==='answer')descriptions[role]=value.description;
      if(value.type==='candidate')candidates[role].push({id:String(++sequence),...value.candidate});
      if(['ready','offer','answer','candidate'].includes(value.type)){const other=role==='caller'?'callee':'caller';update(other,{type:'remote',description:descriptions[role]||null,candidates:candidates[role]});}
    });window.states=states;
  </script></body></html>`);
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const access of ['microphone', 'front', 'back']) {
      await page.goto(origin); assert.equal(await page.locator('iframe').count(), 0);
      await page.evaluate(access => window.start(access), access);
      await page.waitForFunction(() => window.states.error || window.states.caller === 'connected' && window.states.callee === 'connected', null, { timeout: 20000 });
      assert.equal(await page.evaluate(() => window.states.error), undefined);
      const receiver = await (await page.locator('#caller').elementHandle()).contentFrame();
      const sender = await (await page.locator('#callee').elementHandle()).contentFrame();
      assert.equal(await receiver.evaluate(() => window.captureCount), 0, 'Requester never captures media');
      assert.equal(await sender.evaluate(() => window.captureCount), 1);
      assert.equal(await sender.evaluate(() => stream.getTracks().length), access === 'microphone' ? 1 : 2);
      assert(await sender.evaluate(() => stream.getTracks().every(track => /fake/i.test(track.label))));
      await receiver.waitForFunction(async () => [...(await peer.getStats()).values()].some(item => item.type === 'inbound-rtp' && item.kind === 'audio' && item.bytesReceived > 0));
      assert.equal(await sender.evaluate(async () => [...(await peer.getStats()).values()].some(item => item.type === 'inbound-rtp')), false);
      if (access !== 'microphone') {
        assert.equal(await sender.evaluate(() => window.captureConstraints[0].video.facingMode.exact), access === 'back' ? 'environment' : 'user');
        await receiver.waitForFunction(() => document.getElementById('remote').videoWidth > 0);
      }
      await page.evaluate(() => window.update('callee', { type: 'controls', muted: true, cameraOff: true }));
      await sender.waitForFunction(() => stream.getTracks().every(track => !track.enabled));
      await page.evaluate(() => { window.update('callee', { type: 'stop' }); window.update('caller', { type: 'stop' }); });
      await sender.waitForFunction(() => stream.getTracks().every(track => track.readyState === 'ended') && peer.connectionState === 'closed');
      await receiver.waitForFunction(() => peer.connectionState === 'closed');
      console.log(`PASS ${access}: one-way WebRTC packets${access === 'microphone' ? '' : ' and video frames'}, no requester capture, local controls and stop cleanup`);
    }
    assert.deepEqual(errors, []);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
