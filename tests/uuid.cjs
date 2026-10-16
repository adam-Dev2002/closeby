const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { webcrypto } = require('node:crypto');

const source = ts.transpileModule(fs.readFileSync('src/lib/uuid.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(platform, nativeCrypto, browserCrypto) {
  const module = { exports: {} };
  const guardedMath = Object.create(Math);
  guardedMath.random = () => { throw Error('Noncryptographic fallback is forbidden'); };
  vm.runInNewContext(source, {
    module, exports: module.exports, crypto: browserCrypto, Uint8Array, Math: guardedMath,
    require(name) {
      if (name === 'expo-crypto') return nativeCrypto;
      if (name === 'react-native') return { Platform: { OS: platform } };
      throw Error(`Unexpected dependency: ${name}`);
    },
  });
  return module.exports.randomUuid;
}
const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const forbidden = () => { throw Error('The secure-context-only UUID API and Expo dev byte fallback must not be used'); };

test('LAN HTTP browser generates a version 4 UUID without crypto.randomUUID', () => {
  let calls = 0;
  const browserCrypto = {
    randomUUID: forbidden,
    getRandomValues(bytes) { assert.equal(this, browserCrypto); calls++; bytes.fill(255); return bytes; },
  };
  const uuid = load('web', { getRandomValues: forbidden, getRandomBytes: forbidden }, browserCrypto)();
  assert.equal(uuid, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.match(uuid, shape);
  assert.equal(calls, 1);
});

test('native uses the secure Expo byte provider and preserves all nonreserved bits', () => {
  let calls = 0;
  const nativeCrypto = {
    randomUUID: forbidden, getRandomBytes: forbidden,
    getRandomValues(bytes) { calls++; bytes.forEach((_value, index) => bytes[index] = index * 17); return bytes; },
  };
  const uuid = load('android', nativeCrypto, { getRandomValues: forbidden })();
  assert.equal(uuid, '00112233-4455-4677-8899-aabbccddeeff');
  assert.equal(calls, 1);
  assert.match(uuid, shape);
});

test('real secure browser provider produces distinct correctly formatted IDs', () => {
  const randomUuid = load('web', { getRandomValues: forbidden }, webcrypto);
  const ids = Array.from({ length: 1000 }, () => randomUuid());
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.every(id => shape.test(id)));
});

test('unsupported secure randomness fails clearly without guessing an ID', () => {
  assert.throws(load('web', { getRandomValues: forbidden }, undefined), /Secure random IDs are unavailable in this browser/);
  assert.throws(load('web', { getRandomValues: forbidden }, {}), /Secure random IDs are unavailable in this browser/);
  assert.throws(load('ios', {}, undefined), /Secure random IDs are unavailable on this device/);
  assert.throws(load('android', { getRandomValues() { throw Error('Secure native source failed'); } }, undefined), /Secure native source failed/);
});
