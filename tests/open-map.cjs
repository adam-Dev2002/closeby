const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

function load(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, process: { env: {} }, URL,
    require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return module.exports;
}
const model = load('src/lib/mapModel.ts');
const avatars = load('src/lib/avatars.ts');
const api = load('src/lib/openMap.ts', { './mapModel': model, './avatars': avatars, './placePresence': load('src/lib/placePresence.ts') });
const renderer = load('src/lib/openMapHtml.ts', { './openMap': api, './mapModel': model, './avatars': avatars });
const plain = value => JSON.parse(JSON.stringify(value));
const fix = { latitude: 14.55, longitude: 121.02, accuracy: 10, speed: 0, heading: null, timestamp: Date.now() };
const props = { devices: [], selectedId: '', location: null, route: [], zones: [], onSelect() {} };

test('missing and invalid GPS produce no pins or invented coordinates', () => {
  const state = api.openMapState({ ...props, devices: [{ id: 'missing', location: null }, { id: 'invalid', location: { ...fix, latitude: 95 } }], location: { ...fix, timestamp: 0 }, route: [{ latitude: NaN, longitude: 2 }] });
  assert.deepEqual(plain(state.devices), []);
  assert.deepEqual(plain(state.route), []);
  assert.equal(state.location, null);
  assert.equal(state.bounds, null);
});

test('only valid measured devices, routes, and safe zones cross the map bridge', () => {
  const state = api.openMapState({ ...props, devices: [{ id: 'own', name: 'My Phone', location: fix, ownerId: 'private' }], location: fix,
    zones: [{ id: 'valid', coordinate: fix, radius: 100 }, { id: 'invalid', coordinate: fix, radius: -1 }], route: [fix, { latitude: 95, longitude: 0 }], bottomInset: Infinity });
  assert.equal(state.devices.length, 1);
  assert.equal(state.devices[0].ownerId, undefined);
  assert.equal(state.zones.length, 1);
  assert.deepEqual(plain(state.route), [{ latitude: 14.55, longitude: 121.02 }]);
  assert.equal(state.bottomInset, 0);
});

test('map portraits prefer chosen avatars, accept profile photos, and reject unsafe image sources', () => {
  const profiles = [
    { avatarId: 'face-2-mint', photoURL: 'https://example.com/photo.jpg' },
    { avatarId: null, photoURL: 'https://example.com/photo.jpg' },
    { avatarId: 'invalid', photoURL: 'javascript:alert(1)' },
    { avatarId: null, photoURL: null },
  ];
  const state = api.openMapState({ ...props, devices: profiles.map((profile, index) => ({ ...profile, id: String(index), name: 'Member', location: fix })) });
  assert.match(state.devices[0].portraitSource, /^data:image\/svg\+xml/);
  assert.equal(state.devices[1].portraitSource, profiles[1].photoURL);
  assert.equal(state.devices[2].portraitSource, null);
  assert.equal(state.devices[3].portraitSource, null);
});

test('routes crossing the antimeridian keep narrow bounds', () => {
  const bounds = api.openMapState({ ...props, route: [{ latitude: 1, longitude: 179.9 }, { latitude: 2, longitude: -179.9 }] }).bounds;
  assert.equal(bounds.west, 179.9);
  assert.equal(bounds.east, -179.9);
});

test('untrusted names cannot close a script or insert HTML in the map document', () => {
  const name = '</script><script>window.hacked=true</script><img src=x onerror=alert(1)>&\u2028';
  const state = api.openMapState({ ...props, devices: [{ id: 'own', name, location: fix }] });
  const html = renderer.openMapHtml('channel', state);
  assert.equal(html.includes(name), false);
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.equal(JSON.parse(api.mapJson({ name })).name, name);
});

test('bridge ignores malformed, wrong-channel, unknown-device, and invalid-coordinate messages', () => {
  const state = api.openMapState({ ...props, devices: [{ id: 'own', name: 'Phone', location: fix }] });
  for (const message of ['{', null, { channel: 'other', type: 'ready' }, { channel: 'ok', type: 'select', id: 'unknown' }, { channel: 'ok', type: 'press', coordinate: { latitude: 100, longitude: 0 } }]) {
    assert.equal(api.readMapMessage(message, 'ok', state), null);
  }
  assert.deepEqual(plain(api.readMapMessage({ channel: 'ok', type: 'select', id: 'own' }, 'ok', state)), { type: 'select', id: 'own' });
  assert.equal(api.readMapMessage({ channel: 'ok', type: 'press', coordinate: fix }, 'ok', state).type, 'press');
});

test('attribution links accept only the map data providers over HTTPS', () => {
  assert.equal(api.attributionUrl('https://www.openstreetmap.org/copyright'), true);
  assert.equal(api.attributionUrl('https://www.openmaptiles.org/'), true);
  assert.equal(api.attributionUrl('https://maps.eox.at/#data'), true);
  assert.equal(api.attributionUrl('https://creativecommons.org/licenses/by/4.0/'), true);
  for (const url of ['javascript:alert(1)', 'http://www.openstreetmap.org', 'https://www.openstreetmap.org.example.com/', 'file:///etc/passwd']) assert.equal(api.attributionUrl(url), false);
});

test('every selectable basemap crosses the bridge and renders without Google configuration', () => {
  for (const mode of model.mapModes) {
    const state = api.openMapState({ ...props, mapType: mode.id });
    assert.equal(state.mapType, mode.id);
    const style = renderer.openMapStyle(state.mapType);
    for (const layer of style.layers) {
      if (layer.source) assert(style.sources[layer.source], `${mode.id}: missing source for ${layer.id}`);
    }
    const html = renderer.openMapHtml('channel', state);
    assert.equal(/maps\.googleapis|Google Maps|PROVIDER_GOOGLE/.test(html), false);
    assert(renderer.mapAttribution(mode.id).length > 0);
    if (['satellite', 'hybrid', 'terrain'].includes(mode.id)) {
      assert(style.sources.imagery.tiles[0].startsWith('https://tiles.maps.eox.at/'));
      assert(style.sources.imagery.maxzoom <= 14, 'Overscale existing imagery instead of requesting missing high-zoom tiles');
    }
  }
  assert.equal(api.openMapState({ ...props, mapType: 'obsolete' }).mapType, 'hybrid');
});

test('an ArcGIS token enables sharp satellite tiles only for satellite modes', () => {
  const token = 'test-token/+?&not-a-real-key';
  for (const type of ['satellite', 'hybrid']) {
    const style = renderer.openMapStyle(type, token);
    const url = style.sources.imagery.tiles[0];
    assert(url.startsWith('https://ibasemaps-api.arcgis.com/'));
    assert.equal(new URL(url).searchParams.get('token'), token);
    assert.equal(style.sources.imagery.maxzoom, 19);
    assert(renderer.mapAttribution(type, token).includes('Powered by'));
    assert(!renderer.mapAttribution(type, token).includes('Copernicus'));
  }
  for (const type of ['dark', 'standard', 'terrain']) {
    assert(!JSON.stringify(renderer.openMapStyle(type, token)).includes('token='));
    assert(!renderer.openMapHtml('test', api.openMapState({ ...props, mapType: type }), token).includes(encodeURIComponent(token)));
  }
});

async function arcgisDocument(metadata, ok = true) {
  const messages = [], requests = [], maps = [];
  const credit = { textContent: '', innerHTML: 'untouched' };
  const window = { matchMedia: () => ({ matches: true }), addEventListener() {}, parent: { postMessage: value => messages.push(value) } };
  class MapStub {
    constructor(options) { maps.push(options); this.touchZoomRotate = { disableRotation() {} }; }
    on() {}
  }
  const html = renderer.openMapHtml('test', api.openMapState({ ...props, mapType: 'satellite' }), 'test-token');
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    window, document: { getElementById: () => credit, addEventListener() {} },
    maplibregl: { Map: MapStub }, ResizeObserver: class { observe() {} },
    setInterval: () => 1, fetch: async url => { requests.push(url); return { ok, json: async () => metadata }; },
  });
  await window.closebyStart();
  return { credit, maps, messages, requests };
}

test('ArcGIS source credits are fetched before showing imagery and treated as plain text', async () => {
  const copyrightText = 'Provider <img src=x onerror=alert(1)> & Contributors';
  const result = await arcgisDocument({ copyrightText });
  assert.equal(result.maps.length, 1);
  assert.equal(result.credit.textContent, copyrightText);
  assert.equal(result.credit.innerHTML, 'untouched');
  assert.equal(new URL(result.requests[0]).searchParams.get('token'), 'test-token');
  assert.deepEqual(result.messages, []);
});

test('rejected ArcGIS credentials show a useful error without exposing the token or starting tiles', async () => {
  const result = await arcgisDocument({ error: { code: 403, message: 'test-token' } });
  assert.equal(result.maps.length, 0);
  assert.equal(result.messages[0].type, 'error');
  assert(result.messages[0].message.includes('basemap permissions'));
  assert(!result.messages[0].message.includes('test-token'));
});

module.exports = { api, renderer, props, fix };
