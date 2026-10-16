const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

function load(file, dependencies, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, process: { env: {} }, URL, setTimeout, clearTimeout, ...globals, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error(`Unexpected dependency: ${name}`);
  } });
  return module.exports;
}
const model = load('src/lib/mapModel.ts', {});
const MapView = function MapView() {}, Marker = function Marker() {}, Circle = function Circle() {}, Polyline = function Polyline() {};
const jsx = (type, props, key) => ({ type, props, key });
const component = load('src/components/GoogleTrackingMap.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
  react: { useCallback: action => action, useEffect() {}, useMemo: action => action(), useRef: current => ({ current }), useState: initial => [initial, () => {}] },
  expo: { isRunningInExpoGo: () => true },
  'react-native': { ActivityIndicator: 'Spinner', Image: 'Image', Platform: { OS: 'android' }, StyleSheet: { create: value => value, absoluteFill: {} }, Text: 'Text', View: 'View', UIManager: {}, useWindowDimensions: () => ({ width: 390 }) },
  'react-native-maps': { __esModule: true, default: MapView, Marker, Circle, Polyline, PROVIDER_GOOGLE: 'google' },
  '../lib/mapModel': model, '../theme': { colors: { blue: '#1186FF', blueLight: '#4AB2FF', green: '#3EED95', muted: '#91A9C6' } },
  './MapUnavailable': { MapUnavailable: 'MapUnavailable' },
  './Ui': { Avatar: 'Avatar' },
  './Icon': { Icon: 'Icon' },
  './BatteryBadge': { BatteryBadge: 'BatteryBadge' },
  '../lib/placePresence': load('src/lib/placePresence.ts', {}),
  '../lib/avatars': load('src/lib/avatars.ts', {}),
});
function find(tree, type) {
  if (!tree || typeof tree !== 'object') return null;
  if (Array.isArray(tree)) return tree.map(item => find(item, type)).find(Boolean);
  if (tree.type === type) return tree;
  if (typeof tree.type === 'function' && tree.type !== MapView) {
    const rendered = find(tree.type(tree.props), type);
    if (rendered) return rendered;
  }
  return find(tree.props?.children, type);
}
const props = { devices: [], selectedId: '', onSelect() {}, location: null, route: [], zones: [] };

test('Google renderer supports all modes and styles only dark streets', () => {
  for (const mode of model.mapModes) {
    const tree = component.LiveMap({ ...props, mapType: mode.id, bottomInset: 240 });
    const map = find(tree, MapView);
    assert(map, `${mode.id} needs no project API key in Android Expo Go`);
    assert.equal(map.props.provider, 'google');
    assert.equal(map.props.mapType, mode.id === 'dark' ? 'standard' : mode.id);
    assert.equal(map.props.customMapStyle.length > 0, mode.id === 'dark');
    assert.equal(map.props.userInterfaceStyle, mode.id === 'dark' ? 'dark' : 'light');
    const mapArea = find(tree, 'View').props.children;
    assert.equal(mapArea.props.style[1].marginBottom, 240, 'SDK and its attribution stay above the device card');
  }
});

test('native Google map rejects invalid GPS while retaining measured pins, routes, and taps', () => {
  const fix = { latitude: 14.55, longitude: 121.02, timestamp: Date.now(), accuracy: 10 };
  const presses = [];
  const tree = component.LiveMap({ ...props, selectedId: 'own', devices: [{ id: 'own', name: 'Phone', location: fix }, { id: 'bad', name: 'Missing', location: null }], location: fix,
    route: [fix, { ...fix, latitude: 14.551 }], onMapPress: point => presses.push(point) });
  assert.equal(find(tree, Marker).props.title, 'Phone');
  assert.equal(find(tree, Polyline).props.coordinates.length, 2);
  const map = find(tree, MapView);
  map.props.onPress({ nativeEvent: { coordinate: { latitude: 100, longitude: 0 } } });
  assert.equal(presses.length, 0);
  map.props.onPress({ nativeEvent: { coordinate: fix } });
  assert.equal(presses[0], fix);
});

test('safe places use named pins, keep the selected location, and accept Google place taps', () => {
  const coordinate = { latitude: 9.30848, longitude: 123.26258 };
  const zone = { id: 'home', name: 'Home', description: 'Main entrance', coordinate, radius: 200, color: '#1186FF', enabled: true };
  const places = [], selections = [];
  const tree = component.LiveMap({ ...props, zones: [zone], focusCoordinate: coordinate,
    location: { latitude: 14.55, longitude: 121.02, timestamp: Date.now(), accuracy: 0 },
    onZoneSelect: id => selections.push(id), onPlacePress: (point, name) => places.push({ point, name }) });
  const marker = find(tree, Marker), map = find(tree, MapView);
  assert.equal(marker.props.coordinate, coordinate);
  assert.match(marker.props.accessibilityLabel, /Home.*Main entrance/);
  assert(!find(tree, Circle), 'a named pin is shown without a diameter-based circle');
  assert.equal(map.props.initialRegion.latitude, coordinate.latitude, 'the chosen pin controls the camera rather than the phone GPS');
  marker.props.onPress(); assert.deepEqual(selections, ['home']);
  map.props.onPoiClick({ nativeEvent: { coordinate, name: 'School entrance' } });
  assert.deepEqual(places, [{ point: coordinate, name: 'School entrance' }]);
  map.props.onPoiClick({ nativeEvent: { coordinate: { latitude: 100, longitude: 0 }, name: 'Invalid' } });
  assert.equal(places.length, 1);
  const withDistance = component.LiveMap({ ...props, zones: [zone], showZoneBoundaries: true });
  assert.equal(find(withDistance, Circle).props.center, coordinate, 'optional arrival distance stays centered on the same pin');
});

test('portrait pins keep profile identity, selection, and stale location status', () => {
  const selected = [];
  const device = { id: 'person', name: 'Ana Cruz', photoURL: 'https://example.com/ana.jpg', avatarId: null,
    location: { latitude: 14.55, longitude: 121.02, timestamp: Date.now() } };
  const tree = component.LiveMap({ ...props, devices: [device], selectedId: device.id, onSelect: id => selected.push(id) });
  const marker = find(tree, Marker), portrait = find(tree, 'Avatar');
  const photo = marker.props.children.find(child => child?.type === 'Image');
  assert.equal(photo.props.source.uri, device.photoURL, 'the profile photo is a direct marker child so Android attaches its image loader');
  assert.equal(portrait.props.device.photoURL, null, 'the nested avatar supplies the fallback without a second network image');
  assert.equal(marker.props.identifier, device.id);
  assert.equal(marker.props.tracksViewChanges, true, 'the first portrait must be captured before marker tracking freezes');
  assert.equal(marker.props.anchor.y, 1, 'the pointer touches the measured coordinate');
  assert.equal(marker.props.accessibilityState.selected, true);
  marker.props.onPress();
  assert.deepEqual(selected, [device.id]);
  const avatarDevice = { ...device, photoURL: null, avatarId: 'face-2-mint', location: { ...device.location, timestamp: Date.now() - 60000 } };
  const updated = component.LiveMap({ ...props, devices: [avatarDevice] });
  const updatedPortrait = find(updated, 'Avatar'), stale = find(updated, Marker);
  assert.equal(updatedPortrait.props.device.avatarId, avatarDevice.avatarId);
  assert.notEqual(updatedPortrait.key, portrait.key, 'changing a profile clears the previous image state');
  assert.equal(stale.props.description, 'Last known position');
  assert.match(stale.props.accessibilityLabel, /Ana Cruz.*Last known position/);
  assert.equal(stale.props.accessibilityState.selected, false);
  assert.equal(stale.props.children.some(child => child?.type === 'Image'), false, 'chosen SVG avatars do not start an unrelated profile-photo request');
});

test('the portrait pin includes measured battery and an observed stay bubble without moving its GPS tip', () => {
  const now = Date.now();
  const device = { id: 'person', name: 'Ana', batteryLevel: .92, photoURL: 'https://example.com/photo.jpg',
    location: { latitude: 14.55, longitude: 121.02, timestamp: now } };
  const presence = { person: { zoneId: 'home', name: 'Home', description: '', since: now - 152 * 60000, updatedAt: now, arrivalObserved: true } };
  const tree = component.LiveMap({ ...props, devices: [device], selectedId: device.id, presence });
  const marker = find(tree, Marker), badge = find(tree, 'BatteryBadge');
  assert.equal(badge.props.level, .92);
  assert.match(marker.props.accessibilityLabel, /Battery 92%.*Home.*2 hr 32 min.*Arrived/);
  assert.equal(marker.props.anchor.x, 32 / 226); assert.equal(marker.props.anchor.y, 1);
  const photo = marker.props.children.find(child => child?.type === 'Image');
  assert.equal(photo.props.style[1].top, 62, 'the direct-child photo stays aligned inside the enlarged pin canvas');
  assert.equal(marker.props.coordinate, device.location);
});

test('web portrait pins use safe images, recover to a person icon, and clear removed locations', async () => {
  class DomNode {
    constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.attributes = {}; }
    appendChild(child) { child.remove(); child.parent = this; this.children.push(child); }
    replaceChildren(...children) { this.children.forEach(child => child.parent = null); this.children = []; children.forEach(child => this.appendChild(child)); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    setAttribute(key, value) { this.attributes[key] = value; }
    set innerHTML(_) { throw Error('Untrusted profile values must not be interpolated into markup'); }
  }
  const document = { createElement: tag => new DomNode(tag) };
  const markers = [];
  class WebMarker {
    constructor(options) { Object.assign(this, options); this.listeners = {}; markers.push(this); }
    appendChild(node) { this.node = node; }
    addListener(event, action) { this.listeners[event] = action; return { remove() {} }; }
  }
  class WebMap {
    addListener() { return { remove() {} }; }
    setCenter() {}
    setZoom() {}
    fitBounds() {}
  }
  class WebPolyline { setPath() {} setMap() {} }
  const maps = { Map: WebMap, Polyline: WebPolyline, event: { clearInstanceListeners() {} } };
  const refs = [], effects = [];
  let refCursor = 0;
  const web = load('src/components/GoogleTrackingMap.web.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: {
      createElement(type, properties) { if (properties.ref) properties.ref.current = document.createElement(type); return jsx(type, properties); },
      useEffect: action => effects.push(action), useMemo: action => action(),
      useRef(current) { return refs[refCursor++] ?? (refs[refCursor - 1] = { current }); },
      useState: initial => [initial === false ? true : initial, () => {}],
    },
    'react-native': { ActivityIndicator: 'Spinner', StyleSheet: { create: value => value }, Text: 'Text', View: 'View', useWindowDimensions: () => ({ width: 390, height: 844 }) },
    '../lib/googleMaps.web': { loadGoogleMaps: async () => ({ maps, markers: { AdvancedMarkerElement: WebMarker } }), onGoogleMapsAuthFailure: () => () => {} },
    '../lib/avatars': load('src/lib/avatars.ts', {}),
    '../lib/placePresence': load('src/lib/placePresence.ts', {}),
    '../lib/mapModel': { ...model, googleMapsWebKey: 'test-key' },
    '../theme': { colors: { blue: '#1186FF', blueLight: '#4AB2FF', green: '#3EED95', muted: '#91A9C6' } },
    './MapUnavailable': { MapUnavailable: 'MapUnavailable' },
  }, { document });
  const descendant = (node, tag) => node.tag === tag ? node : node.children.map(child => descendant(child, tag)).find(Boolean);
  const selections = [];
  let device = { id: 'person', name: '<script> Ana', photoURL: 'https://example.com/photo.jpg', avatarId: null,
    location: { latitude: 14.55, longitude: 121.02, timestamp: Date.now() } };
  const render = () => {
    refCursor = 0; effects.length = 0;
    web.LiveMap({ ...props, devices: [device], selectedId: device.id, onSelect: id => selections.push(id) });
  };
  render();
  const cleanup = effects[1]();
  await Promise.resolve();
  effects[2]();
  assert.equal(markers.length, 1);
  const marker = markers[0], originalImage = descendant(marker.node, 'img');
  assert.equal(originalImage.src, device.photoURL);
  originalImage.onerror();
  assert.equal(descendant(marker.node, 'img'), undefined);
  assert.equal(descendant(marker.node, 'span'), undefined, 'failed profile photos never display initials');
  assert.match(marker.node.children[0].children[0].style.backgroundImage, /data:image\/svg\+xml/, 'the person icon stays visible behind a failed photo');
  marker.listeners.click();
  assert.deepEqual(selections, [device.id]);

  device = { ...device, name: 'Ana Cruz', photoURL: null, avatarId: 'face-2-mint' };
  render(); effects[2]();
  const customImage = descendant(marker.node, 'img');
  assert.match(customImage.src, /^data:image\/svg\+xml;charset=utf-8,/);
  originalImage.onerror();
  assert.equal(descendant(marker.node, 'img'), customImage, 'late callbacks from an old photo cannot erase its replacement');
  assert.equal(markers.length, 1, 'a profile edit preserves the location marker and click listener');

  device = { ...device, photoURL: 'javascript:alert(1)', avatarId: '<svg onload="alert(1)">' };
  render(); effects[2]();
  assert.equal(descendant(marker.node, 'img'), undefined, 'untrusted image protocols and avatar identifiers are rejected');
  assert.equal(descendant(marker.node, 'span'), undefined);
  device = { ...device, location: null };
  render(); effects[2]();
  assert.equal(marker.map, null, 'sharing removal cannot leave a stale pin on the map');
  cleanup();
});
