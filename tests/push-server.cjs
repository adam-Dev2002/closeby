// Real Firestore transactions on the isolated emulator; FCM is captured locally.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const serverRequire = createRequire(require.resolve('../functions/package.json'));
const { initializeApp, deleteApp } = serverRequire('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = serverRequire('firebase-admin/firestore');
const { createNotificationServer } = require('../functions/engine.cjs');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Run this test only through the demo-closeby Firestore emulator.');
let app, db, server, now, sent, provider;
const zone = { id: 'home', name: 'Home', coordinate: { latitude: 14.55, longitude: 121.02 }, radius: 100, color: '#1186FF', enabled: true };
const preferences = () => ({ enabled: true, arrivals: true, speed: true, speedLimitKmh: 80, zones: [zone], generation: '12345678-1234-4123-a123-123456789abc', updatedAt: Timestamp.fromMillis(now) });
const set = (path, value) => db.doc(path).set(value);
const jobs = async () => (await db.collection('notificationOutbox').get()).docs;
const call = (overrides = {}) => ({ callerId: 'alice', calleeId: 'bob', callerName: 'Alice', status: 'ringing', mode: 'video', createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + 120000), ...overrides });
before(() => { app = initializeApp({ projectId: 'demo-closeby' }, 'push-server-test'); db = getFirestore(app); });
beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-closeby/databases/(default)/documents`, { method: 'DELETE' });
  assert(response.ok); now = Date.now(); sent = []; provider = null;
  server = createNotificationServer({ db, Timestamp, FieldValue, now: () => now, messaging: { sendEachForMulticast: async value => {
    sent.push(value); return provider ? provider(value) : { responses: value.tokens.map(() => ({ success: true })) };
  } } });
  await set('appStatus/notifications', { enabled: true }); await set('circles/space', { ownerId: 'owner' });
  for (const uid of ['owner', 'alice', 'bob']) {
    await set(`users/${uid}`, { circleId: 'space' }); await set(`circles/space/members/${uid}`, { uid });
    await set(`users/${uid}/notificationSettings/main`, preferences());
    await set(`users/${uid}/pushDevices/phone`, { token: `synthetic-${uid}`, platform: 'android', updatedAt: Timestamp.fromMillis(now) });
  }
});
after(async () => { await db?.terminate(); if (app) await deleteApp(app); });

test('owner-only emergency targets only the owner and never exposes text or coordinates in the push', async () => {
  await set('circles/space/alerts/alert', { senderId: 'alice', senderName: 'Alice', audience: 'owner', ownerId: 'owner', text: 'private emergency details', location: zone.coordinate, createdAt: Timestamp.fromMillis(now) });
  await server.eventCreated('space', 'emergency', 'alert'); await server.eventCreated('space', 'emergency', 'alert');
  const outbox = await jobs(); assert.equal(outbox.length, 1); assert.equal(outbox[0].data().uid, 'owner');
  await server.deliver(outbox[0].id); await server.deliver(outbox[0].id);
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].tokens, ['synthetic-owner']); assert.equal(sent[0].android.notification.sound, 'closeby_alert');
  assert(!JSON.stringify(sent).includes('private emergency details')); assert(!JSON.stringify(sent).includes('14.55'));
});
test('public emergencies and messages notify current members except their sender; disabled recipients stay silent', async () => {
  await set('users/bob/notificationSettings/main', { ...preferences(), enabled: false });
  for (const [kind, collection] of [['emergency', 'alerts'], ['message', 'messages']]) {
    await set(`circles/space/${collection}/event`, { senderId: 'alice', senderName: 'Alice', audience: 'everyone', ownerId: 'owner', text: 'private chat', createdAt: Timestamp.fromMillis(now) });
    await server.eventCreated('space', kind, 'event');
  }
  const outbox = await jobs(); assert.equal(outbox.length, 2); assert(outbox.every(job => job.data().uid === 'owner'));
  for (const job of outbox) await server.deliver(job.id); assert.equal(sent.length, 2); assert(!JSON.stringify(sent).includes('private chat'));
});
test('a call push has a short TTL, targets its recipient, and never accepts or captures media', async () => {
  await set('circles/space/calls/call', call()); await server.eventCreated('space', 'call', 'call');
  const outbox = await jobs(); assert.equal(outbox.length, 1); assert.equal(outbox[0].data().uid, 'bob');
  await server.deliver(outbox[0].id); assert.equal(sent[0].data.kind, 'call'); assert(sent[0].android.ttl <= 120000);
  assert.equal(sent[0].android.notification.sound, 'closeby_call'); assert.equal((await db.doc('circles/space/calls/call').get()).data().status, 'ringing');
});
test('ended calls, revoked device-request permissions, removed recipients and disabled notifications are rechecked before dispatch', async () => {
  for (const scenario of ['ended', 'revoked', 'removed', 'disabled']) {
    await set('circles/space/members/bob', { uid: 'bob' }); await set('users/bob/notificationSettings/main', preferences());
    await set('circles/space/members/alice', { uid: 'alice', canRequestMedia: true });
    await set(`circles/space/calls/${scenario}`, call({ access: 'front' })); await server.eventCreated('space', 'call', scenario);
    const job = (await jobs()).find(job => job.data().resourceId === scenario); assert(job);
    if (scenario === 'ended') await db.doc(`circles/space/calls/${scenario}`).update({ status: 'ended' });
    if (scenario === 'revoked') await db.doc('circles/space/members/alice').update({ canRequestMedia: false });
    if (scenario === 'removed') await db.doc('circles/space/members/bob').delete();
    if (scenario === 'disabled') await db.doc('users/bob/notificationSettings/main').update({ enabled: false });
    await server.deliver(job.id); assert.equal((await job.ref.get()).data().status, 'skipped');
  }
  assert.equal(sent.length, 0);
});
test('expired and unauthorized device requests create no notification', async () => {
  await set('circles/space/calls/expired', call({ expiresAt: Timestamp.fromMillis(now - 1) })); await server.eventCreated('space', 'call', 'expired');
  await set('circles/space/calls/unauthorized', call({ access: 'front' })); await server.eventCreated('space', 'call', 'unauthorized');
  assert.equal((await jobs()).length, 0);
});
async function fix(timestamp, inside, speed = 0, accuracy = 5) {
  now = timestamp;
  await set('circles/space/devices/alice', { id: 'alice', ownerId: 'alice', name: 'Alice phone', sharing: true,
    location: { latitude: inside ? 14.55 : 14.56, longitude: 121.02, timestamp, accuracy, speed, heading: null } });
  await server.deviceChanged('space', 'alice');
}
test('server observes confirmed arrivals and departures across separate invocations without inventing a first-seen arrival', async () => {
  const start = now; await fix(start, false); assert.equal((await jobs()).length, 0);
  await fix(start + 10000, true); assert.equal((await jobs()).length, 0);
  await fix(start + 14000, true); await server.deviceChanged('space', 'alice');
  assert.equal((await jobs()).filter(job => job.data().kind === 'arrival').length, 3);
  await fix(start + 24000, false); await fix(start + 28000, false);
  assert.equal((await jobs()).filter(job => job.data().kind === 'departure').length, 3);
  const job = (await jobs()).find(job => job.data().uid === 'bob' && job.data().kind === 'arrival'); await server.deliver(job.id);
  assert.equal(sent[0].data.deviceId, 'alice'); assert.equal(sent[0].android.notification.channelId, 'closeby-arrivals-v1');
});
test('speed confirmation, cooldown and disarming survive separate server invocations', async () => {
  const start = now; await fix(start, false, 30); assert.equal((await jobs()).length, 0);
  await fix(start + 4000, false, 30); assert.equal((await jobs()).filter(job => job.data().kind === 'speed').length, 3);
  await fix(start + 14000, false, 30); assert.equal((await jobs()).length, 3);
});
test('a gap or settings change establishes a new arrival baseline; pausing removes observation state', async () => {
  const start = now; await fix(start, false);
  now += 180000; await fix(now, true); assert.equal((await jobs()).length, 0);
  await db.doc('users/bob/notificationSettings/main').update({ generation: '23456789-1234-4123-a123-123456789abc' });
  await fix(now + 10000, false); assert.equal((await jobs()).length, 0);
  await db.doc('circles/space/devices/alice').update({ sharing: false, location: null }); await server.deviceChanged('space', 'alice');
  assert.equal((await db.collection('users/bob/notificationState').get()).size, 0);
});
test('invalid tokens are removed, temporary FCM failure retries, and acknowledged endpoints do not receive another send', async () => {
  await set('users/bob/pushDevices/second', { token: 'second', platform: 'android', updatedAt: Timestamp.fromMillis(now) });
  await set('circles/space/calls/call', call()); await server.eventCreated('space', 'call', 'call'); const [job] = await jobs();
  provider = value => ({ responses: value.tokens.map(token => token === 'second' ? { success: false, error: { code: 'messaging/server-unavailable' } } : { success: true }) });
  await assert.rejects(server.deliver(job.id), /temporarily unavailable/);
  provider = value => ({ responses: value.tokens.map(() => ({ success: false, error: { code: 'messaging/registration-token-not-registered' } })) });
  await server.deliver(job.id); assert.deepEqual(sent[1].tokens, ['second']); assert(!(await db.doc('users/bob/pushDevices/second').get()).exists);
  assert((await db.doc('users/bob/pushDevices/phone').get()).exists);
});
test('expired notification jobs and an inactive delivery service send nothing', async () => {
  await set('circles/space/calls/call', call()); await server.eventCreated('space', 'call', 'call'); const [job] = await jobs();
  now += 120001; await server.deliver(job.id); assert.equal(sent.length, 0);
  await set('appStatus/notifications', { enabled: false }); await set('circles/space/calls/new', call()); await server.eventCreated('space', 'call', 'new');
  assert.equal((await jobs()).length, 1);
});
