const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomBytes } = require('node:crypto');
const ts = require('../node_modules/typescript');

function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, URL, require(name) { assert(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return module.exports;
}
const api = load('src/lib/invitations.ts');
const CODE = 'ABCD2345WXYZ';

test('new invitation codes use twelve unambiguous random characters', () => {
  assert.equal(api.INVITATION_ALPHABET.length, 32);
  assert.equal(new Set(api.INVITATION_ALPHABET).size, 32);
  const codes = new Set();
  for (let i = 0; i < 1000; i++) {
    const code = api.generateInvitationCode(randomBytes(12));
    assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/); codes.add(code);
  }
  assert.equal(codes.size, 1000);
  assert.throws(() => api.generateInvitationCode(randomBytes(6)), /twelve/);
});

test('grouped and lowercase short codes and existing 32-character invitations are accepted', () => {
  assert.equal(api.formatInvitationCode(CODE), 'ABCD-2345-WXYZ');
  assert.equal(api.normalizeInvitationCode(' abcd-2345-wxyz '), CODE);
  assert.equal(api.normalizeInvitationCode('A'.repeat(32)), 'A'.repeat(32));
  for (const value of ['123456', 'A'.repeat(11), 'A'.repeat(13), 'ABCD2345WXIO', 'ß'.repeat(6), '../users', null]) assert.equal(api.normalizeInvitationCode(value), null);
});

test('a shared HTTPS link and the installed-app fallback round trip to the same invitation', () => {
  assert.equal(api.invitationLink(CODE), `${api.INVITATION_ORIGIN}/j/${CODE}`);
  assert.equal(api.invitationCodeFromInput(api.invitationLink(CODE)), CODE);
  assert.equal(api.parseInvitationLink(`closeby://join/${CODE}`), CODE);
  assert.equal(api.parseInvitationLink(`${api.INVITATION_ORIGIN}/j/${CODE}?utm_source=message`), CODE);
  assert.equal(api.invitationCodeFromInput(api.invitationLink('A'.repeat(32))), 'A'.repeat(32));
});

test('foreign, insecure, credential-bearing and unrelated app links cannot become invitations', () => {
  for (const value of [
    `https://example.com/j/${CODE}`, `http://closeby-511018.web.app/j/${CODE}`,
    `https://closeby-511018.web.app.evil.test/j/${CODE}`, `https://user@closeby-511018.web.app/j/${CODE}`,
    `https://closeby-511018.web.app:8443/j/${CODE}`, `closeby://settings/${CODE}`, `closeby://join/${CODE}/extra`,
    `javascript:/j/${CODE}`, `${api.INVITATION_ORIGIN}/j/123456`,
  ]) assert.equal(api.parseInvitationLink(value), null, value);
  assert.equal(api.parseInvitationLink(`http://127.0.0.1:8083/j/${CODE}`, 'http://127.0.0.1:8083'), CODE);
  assert.equal(api.parseInvitationLink(`http://127.0.0.1:8083/j/${CODE}`), null);
});

function hooks({ initialURL = null, saved, read } = {}) {
  const slots = [], listeners = new Set(), storage = new Map(saved ? [['@closeby/pending-invitation/v1', JSON.stringify(saved)]] : []);
  let cursor = 0, dirty = false, effects = [], result;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const index = cursor++; slots[index] ||= { value: initial }; return [slots[index].value, value => { const next = typeof value === 'function' ? value(slots[index].value) : value; if (next !== slots[index].value) { slots[index].value = next; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useCallback(value, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { value, deps }; return slots[index].value; },
    useEffect(effect, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const previous = slots[index], slot = slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); }); } },
  };
  const hook = load('src/hooks/useInvitationLink.ts', {
    react, '../lib/invitations': api,
    'react-native': { Platform: { OS: 'android' }, Linking: { getInitialURL: async () => initialURL,
      addEventListener(_name, next) { listeners.add(next); return { remove: () => listeners.delete(next) }; } } },
    '@react-native-async-storage/async-storage': { getItem: read || (async key => storage.get(key) ?? null), setItem: async (key, value) => storage.set(key, value), removeItem: async key => storage.delete(key) },
  });
  const flush = () => {
    let turns = 0;
    do { assert(++turns < 30); cursor = 0; dirty = false; result = hook.useInvitationLink(); const current = effects; effects = []; current.forEach(effect => effect()); } while (dirty || effects.length);
    return result;
  };
  return { flush, storage,
    async settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); flush(); } return result; },
    receive(url) { for (const next of listeners) next({ url }); return flush(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test('cold-start invitations are saved before sign-in without joining or asking for GPS', async () => {
  const h = hooks({ initialURL: api.invitationLink(CODE) }); h.flush(); const current = await h.settle();
  assert.equal(current.pending.code, CODE); assert.equal(JSON.parse(h.storage.values().next().value).code, CODE);
  h.unmount();
});

test('pending invitations survive reopening and dismissing an old invitation cannot clear a newer link', async () => {
  const h = hooks({ saved: { code: CODE, key: 'saved', receivedAt: Date.now() } }); h.flush();
  assert.equal((await h.settle()).pending.code, CODE);
  const newer = h.receive(api.invitationLink('WXYZ2345ABCD')).pending;
  h.flush().dismiss('saved'); assert.equal(h.flush().pending.key, newer.key);
  h.flush().dismiss(newer.key); await h.settle();
  assert.equal(h.flush().pending, null); assert.equal(h.storage.size, 0); h.unmount();
});

test('late saved data and an older initial URL cannot replace a new invitation event', async () => {
  let finishRead, finishInitial;
  const old = JSON.stringify({ code: CODE, key: 'old', receivedAt: Date.now() });
  const read = new Promise(resolve => { finishRead = resolve; });
  const initial = new Promise(resolve => { finishInitial = resolve; });
  const h = hooks({ initialURL: initial, read: async () => read }); h.flush();
  h.receive(api.invitationLink('WXYZ2345ABCD'));
  finishRead(old); finishInitial(api.invitationLink(CODE));
  assert.equal((await h.settle()).pending.code, 'WXYZ2345ABCD');
  h.receive('https://example.com/j/ABCD2345WXYZ'); assert.equal(h.flush().pending.code, 'WXYZ2345ABCD');
  h.unmount(); h.receive(api.invitationLink(CODE)); assert.equal(h.flush().pending.code, 'WXYZ2345ABCD');
});

test('expired local invitations do not reappear after reopening', async () => {
  const h = hooks({ saved: { code: CODE, key: 'expired', receivedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 } }); h.flush();
  assert.equal((await h.settle()).pending, null); h.unmount();
});
