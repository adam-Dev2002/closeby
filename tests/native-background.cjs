// Actual Android emulator + Chrome WebRTC. Dedicated debug Metro entry; no
// Firebase, real users, real phones, or physical camera/microphone capture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('../.verification/node_modules/playwright');
const adbPath = '.tools/android-sdk/platform-tools/adb.exe';
const adb = (...args) => execFileSync(adbPath, ['-s', 'emulator-5554', ...args], { encoding: 'utf8', windowsHide: true });
const packageName = 'com.closeby.tracker';
const modes = (process.env.NATIVE_MEDIA_MODES || 'microphone,front,back').split(',');
assert(modes.every(mode => ['microphone', 'front', 'back'].includes(mode)));
let currentAccess;
let offer, candidates = [], nativeCandidates = [], answer, nativeError, stopped, unmounted, state;
const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'POST') {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    if (request.url === '/offer') offer = body;
    if (request.url === '/ice') candidates.push({ id: String(candidates.length), uid: 'local-browser', ...body });
    if (request.url === '/native-signal') { if (body.type === 'answer') answer = body.description; if (body.type === 'candidate') nativeCandidates.push(body.candidate); }
    if (request.url === '/native-error') nativeError = body;
    if (request.url === '/native-stopped') stopped = true;
    if (request.url === '/screen-unmounted') unmounted = true;
    if (request.url === '/native-state') state = body;
    response.end('{}'); return;
  }
  if (request.url === '/signal') { response.end(JSON.stringify({ offer, candidates })); return; }
  if (request.url === '/configuration') { response.end(JSON.stringify({ access: currentAccess, approveLocalTest: true })); return; }
  if (request.url === '/native') { response.end(JSON.stringify({ answer, candidates: nativeCandidates })); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><body><video id="video" autoplay playsinline></video><audio id="audio" autoplay></audio><script>
    let pc;window.received=async()=>{let bytes=0;for(const stat of (await pc.getStats()).values())if(stat.type==='inbound-rtp')bytes+=stat.bytesReceived||0;return bytes;};
    window.start=async video=>{pc=new RTCPeerConnection({iceServers:[]});window.pc=pc;pc.addTransceiver('audio',{direction:'recvonly'});if(video)pc.addTransceiver('video',{direction:'recvonly'});
    pc.ontrack=event=>{const element=document.getElementById(event.track.kind==='video'?'video':'audio');element.srcObject=event.streams[0];element.play().catch(()=>{});};
    pc.onicecandidate=event=>{if(event.candidate)fetch('/ice',{method:'POST',body:JSON.stringify(event.candidate.toJSON())});};
    await pc.setLocalDescription(await pc.createOffer());await fetch('/offer',{method:'POST',body:JSON.stringify(pc.localDescription)});
    let seen=0,busy=false;setInterval(async()=>{if(busy||pc.signalingState==='closed')return;busy=true;try{const next=await(await fetch('/native')).json();if(next.answer&&!pc.remoteDescription)await pc.setRemoteDescription(next.answer);if(pc.remoteDescription)for(const candidate of next.candidates.slice(seen)){await pc.addIceCandidate(candidate);seen++;}}finally{busy=false;}},200);
    };
  </script></body></html>`);
});
const waitFor = async (check, label, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (nativeError) throw new Error(nativeError); if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error(`Timed out: ${label}; phase=${state?.session?.phase}; error=${state?.error}`); };
async function tapText(text, afterText) {
  const result = adb('shell', 'uiautomator', 'dump', '/sdcard/closeby-native-test.xml');
  if (!result.includes('dumped to')) throw new Error('Android accessibility tree is not ready.');
  const xml = adb('shell', 'cat', '/sdcard/closeby-native-test.xml');
  const offset = afterText ? xml.indexOf(`text="${afterText}"`) : 0;
  if (offset < 0) throw new Error(`Notification not visible: ${afterText}`);
  const nodes = xml.slice(offset).match(/<node\b[^>]*>/g) || [];
  const node = nodes.find(node => node.toLowerCase().includes(`text="${text.toLowerCase()}"`) || node.toLowerCase().includes(`content-desc="${text.toLowerCase()}"`));
  if (!node) throw new Error(`Control not visible: ${text}`);
  const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
  adb('shell', 'input', 'tap', String(Math.round((bounds[0] + bounds[2]) / 2)), String(Math.round((bounds[1] + bounds[3]) / 2)));
}
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(8095, '127.0.0.1', resolve));
    await waitFor(() => { try { return adb('shell', 'getprop', 'sys.boot_completed').trim() === '1'; } catch { return false; } }, 'emulator boot', 90000);
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); adb('shell', 'wm', 'dismiss-keyguard');
    adb('reverse', 'tcp:8095', 'tcp:8095'); adb('reverse', 'tcp:8084', 'tcp:8084');
    for (const permission of ['RECORD_AUDIO', 'CAMERA', 'POST_NOTIFICATIONS']) adb('shell', 'pm', 'grant', packageName, `android.permission.${permission}`);
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
      args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
    const page = await browser.newPage();
    for (const access of modes) {
      currentAccess = access;
      adb('shell', 'cmd', 'statusbar', 'collapse');
      offer = null; candidates = []; nativeCandidates = []; answer = null; nativeError = null; stopped = false; unmounted = false; state = null;
      await page.goto('http://127.0.0.1:8095'); await page.evaluate(video => window.start(video), access !== 'microphone');
      const bundle = 'http://127.0.0.1:8084/tests/native-background-fixture.bundle?platform=android&dev=true&minify=false';
      console.log('Launching', access, adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `exp+closeby-phone-tracker://expo-development-client/?url=${encodeURIComponent(bundle)}`, packageName).trim());
      // This owned debug fixture receives approval from this local test driver,
      // rather than automating Android accessibility during cold-start rendering.
      await waitFor(() => state?.session?.call?.access === access, 'native fixture starts the approved test', 90000);
      await waitFor(() => page.evaluate(() => pc.connectionState === 'connected'), 'native peer connection');
      await waitFor(() => page.evaluate(async () => (await received()) > 1000), 'native audio/video packets');
      if (access !== 'microphone') await page.waitForFunction(() => document.getElementById('video').videoWidth > 0);
      adb('shell', 'input', 'keyevent', 'KEYCODE_APP_SWITCH');
      await new Promise(resolve => setTimeout(resolve, 900));
      const size = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)/).slice(1).map(Number);
      adb('shell', 'input', 'swipe', String(Math.round(size[0] / 2)), String(Math.round(size[1] * 0.65)), String(Math.round(size[0] / 2)), '80', '450');
      // Some emulator launchers cannot animate Recent apps reliably. Removing
      // the root task uses Android's task-removal path without killing its FGS.
      await new Promise(resolve => setTimeout(resolve, 1000));
      const remaining = adb('shell', 'dumpsys', 'activity', 'recents').match(/Recent #\d+: Task\{[^\n]* #(\d+) type=standard A=\d+:com\.closeby\.tracker/);
      if (remaining) adb('shell', 'am', 'stack', 'remove', remaining[1]);
      await waitFor(() => !/Recent #\d+: Task\{[^\n]*com\.closeby\.tracker/.test(adb('shell', 'dumpsys', 'activity', 'recents')), 'Closeby removed from Recent apps', 15000);
      const before = await page.evaluate(() => received());
      await waitFor(async () => (await page.evaluate(() => received())) > before + 1000, 'packets after app task removed');
      assert(adb('shell', 'dumpsys', 'activity', 'services', packageName).includes('MediaSessionService'));
      const capturePid = adb('shell', 'pidof', packageName).trim();
      if (access === 'back') {
        adb('shell', 'am', 'force-stop', packageName);
        assert(!adb('shell', 'dumpsys', 'activity', 'services', packageName).includes('MediaSessionService'));
      } else {
        adb('shell', 'cmd', 'statusbar', 'expand-notifications'); await new Promise(resolve => setTimeout(resolve, 700));
        try { await tapText('Stop sharing'); } catch { await tapText('Expand', 'Closeby: live device sharing'); await new Promise(resolve => setTimeout(resolve, 400)); await tapText('Stop sharing'); }
        await waitFor(() => stopped, 'notification Stop sharing releases the session');
        await waitFor(() => !adb('shell', 'dumpsys', 'activity', 'services', packageName).includes('MediaSessionService'), 'foreground service stopped');
        await new Promise(resolve => setTimeout(resolve, 700));
        const nativeLog = adb('logcat', '-d', `--pid=${capturePid}`);
        assert(!nativeLog.includes('MediaStreamTrack has been disposed'), 'Notification stop must not dispose tracks before detaching the native stream');
        adb('shell', 'cmd', 'statusbar', 'collapse');
      }
      console.log(`PASS ${access}: native packets${access === 'microphone' ? '' : ' and video frames'} continue after React screen removal; ${access === 'back' ? 'force-stop terminates service' : 'notification stop terminates capture'}`);
    }
    fs.writeFileSync('.verification/native-background-result.json', JSON.stringify({ passed: true, modes, physicalDevices: false }, null, 2));
  } finally { try { adb('shell', 'am', 'force-stop', packageName); } catch {} if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
