const { createHash } = require('node:crypto');
const { PlacePresenceTracker } = require('./lib/placePresence.cjs');
const { createSpeedAlertEvaluator } = require('./lib/speedAlerts.cjs');
const { phoneChannels, notificationZones } = require('./lib/phoneNotifications.cjs');
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const millis = value => value?.toMillis?.() ?? 0;
const cleanName = value => typeof value === 'string' ? value.slice(0, 100) : 'A member';

function createNotificationServer({ db, messaging, Timestamp, FieldValue, now = Date.now }) {
  const document = path => db.doc(path);
  const get = async path => (await document(path).get()).data();
  const active = async () => (await get('appStatus/notifications'))?.enabled === true;
  const settingsPath = uid => `users/${uid}/notificationSettings/main`;
  const memberPath = (spaceId, uid) => `circles/${spaceId}/members/${uid}`;
  async function eligible(uid, spaceId) {
    const [user, member, settings] = await Promise.all([get(`users/${uid}`), get(memberPath(spaceId, uid)), get(settingsPath(uid))]);
    return user?.circleId === spaceId && member && settings?.enabled && typeof settings.generation === 'string' ? settings : null;
  }
  function job({ uid, spaceId, kind, resourceId, deviceId, sourceTime, generation, sourceEvent, title, body, expiresAt }) {
    return { uid, spaceId, kind, resourceId, ...(deviceId ? { deviceId } : {}), sourceTime, generation, title, body,
      eventId: key(uid, spaceId, kind, sourceEvent), expiresAt: Timestamp.fromMillis(expiresAt), createdAt: Timestamp.fromMillis(now()), status: 'pending' };
  }
  async function enqueue(value) {
    if (millis(value.expiresAt) <= now()) return;
    try { await document(`notificationOutbox/${value.eventId}`).create(value); }
    catch (error) { if (error.code !== 6 && error.code !== 'already-exists') throw error; }
  }
  async function eventCreated(spaceId, kind, resourceId) {
    if (!await active()) return;
    const group = kind === 'call' ? 'calls' : kind === 'emergency' ? 'alerts' : 'messages';
    const source = await get(`circles/${spaceId}/${group}/${resourceId}`);
    if (!source) return;
    const sender = kind === 'call' ? source.callerId : source.senderId;
    const [space, senderMember] = await Promise.all([get(`circles/${spaceId}`), get(memberPath(spaceId, sender))]);
    if (!space || !senderMember) return;
    if (kind === 'call' && (source.status !== 'ringing' || millis(source.expiresAt) <= now() || (source.access && space.ownerId !== sender && !senderMember.canRequestMedia))) return;
    const created = millis(source.createdAt), lifetime = kind === 'call' ? Math.min(millis(source.expiresAt), created + 120000) : created + (kind === 'emergency' ? 600000 : 3600000);
    if (!created || lifetime <= now()) return;
    const members = await db.collection(`circles/${spaceId}/members`).get();
    for (const member of members.docs) {
      const uid = member.id;
      if (uid === sender || (kind === 'call' && uid !== source.calleeId) || (kind === 'emergency' && source.audience !== 'everyone' && uid !== space.ownerId)) continue;
      const settings = await eligible(uid, spaceId); if (!settings) continue;
      const name = cleanName(kind === 'call' ? source.callerName : source.senderName);
      const title = kind === 'emergency' ? `${name} needs help` : kind === 'call' ? source.access ? `${name} requests device access` : `${name} is calling` : `${name} sent a message`;
      const body = kind === 'emergency' ? 'Emergency alert in Closeby. Tap to view.' : kind === 'call' ? 'Tap to open Closeby and approve or decline.' : 'New message in your private space. Tap to read.';
      await enqueue(job({ uid, spaceId, kind, resourceId, sourceTime: created, generation: settings.generation, sourceEvent: resourceId, title, body, expiresAt: lifetime }));
    }
  }
  async function deviceChanged(spaceId, deviceId) {
    if (!await active()) return;
    const members = await db.collection(`circles/${spaceId}/members`).get();
    if (!members.docs.some(member => member.id === deviceId)) return;
    for (const member of members.docs) {
      const uid = member.id, settings = await eligible(uid, spaceId);
      if (!settings || (!settings.arrivals && !settings.speed)) continue;
      const stateRef = document(`users/${uid}/notificationState/${key(spaceId, deviceId)}`);
      await db.runTransaction(async transaction => {
        const [snapshot, deviceSnapshot, membership, currentSettings] = await Promise.all([
          transaction.get(stateRef), transaction.get(document(`circles/${spaceId}/devices/${deviceId}`)),
          transaction.get(document(memberPath(spaceId, deviceId))), transaction.get(document(settingsPath(uid))),
        ]);
        if (!membership.exists || !currentSettings.data()?.enabled || currentSettings.data()?.generation !== settings.generation) return;
        const device = deviceSnapshot.data(), saved = snapshot.data();
        if (!device?.sharing || !device.location) { if (snapshot.exists) transaction.delete(stateRef); return; }
        const timestamp = device.location.timestamp;
        if (!Number.isFinite(timestamp) || now() - timestamp > 45000 || timestamp > now() + 5000 || (saved?.generation === settings.generation && timestamp <= saved.lastFix)) return;
        const tracker = new PlacePresenceTracker(), evaluator = createSpeedAlertEvaluator();
        if (saved?.generation === settings.generation) { tracker.restore(saved.arrivals, spaceId, now()); evaluator.restore(saved.speed); }
        const profile = { ...device, id: deviceId };
        const arrivals = tracker.update([profile], notificationZones(settings.zones || []), uid, true, now()).events;
        const speed = evaluator.evaluate(profile, { enabled: settings.speed, limitKmh: settings.speedLimitKmh, scope: `${uid}/${spaceId}/${settings.generation}`, ownDeviceId: uid, ownTracking: true }, now());
        const events = settings.arrivals ? arrivals.map(event => ({ kind: event.kind, eventId: event.id, sourceTime: event.timestamp,
          title: `${deviceId === uid ? 'You' : cleanName(device.name)} ${event.kind === 'arrival' ? 'arrived at' : 'left'} ${event.placeName}`, body: 'Observed from shared GPS. Tap to view the location.' })) : [];
        if (speed) events.push({ kind: 'speed', eventId: `${deviceId}/${speed.timestamp}`, sourceTime: speed.timestamp,
          title: `${cleanName(device.name)} exceeded your speed limit`, body: `${Math.round(speed.speedKmh)} km/h · limit ${speed.limitKmh} km/h. Tap to view.` });
        transaction.set(stateRef, { generation: settings.generation, lastFix: timestamp, arrivals: tracker.serialize(spaceId), speed: evaluator.serialize(), updatedAt: Timestamp.fromMillis(now()) });
        for (const event of events) {
          const value = job({ uid, spaceId, kind: event.kind, resourceId: deviceId, deviceId, sourceTime: event.sourceTime,
            generation: settings.generation, sourceEvent: event.eventId, title: event.title, body: event.body, expiresAt: event.sourceTime + 120000 });
          transaction.create(document(`notificationOutbox/${value.eventId}`), value);
        }
      });
    }
  }
  async function stillValid(value) {
    const settings = await eligible(value.uid, value.spaceId);
    if (!settings || millis(value.expiresAt) <= now()) return false;
    if (['arrival', 'departure', 'speed'].includes(value.kind) && (settings.generation !== value.generation || !(value.kind === 'speed' ? settings.speed : settings.arrivals))) return false;
    const collection = value.kind === 'call' ? 'calls' : value.kind === 'emergency' ? 'alerts' : value.kind === 'message' ? 'messages' : 'devices';
    const source = await get(`circles/${value.spaceId}/${collection}/${value.resourceId}`);
    if (!source) return false;
    const sender = value.kind === 'call' ? source.callerId : value.deviceId || source.senderId;
    if (!sender || !await get(memberPath(value.spaceId, sender))) return false;
    if (value.kind === 'call') {
      const [space, member] = await Promise.all([get(`circles/${value.spaceId}`), get(memberPath(value.spaceId, sender))]);
      return source.calleeId === value.uid && source.callerId !== value.uid && source.status === 'ringing' && millis(source.expiresAt) > now()
        && (!source.access || space?.ownerId === sender || member?.canRequestMedia === true);
    }
    if (value.kind === 'emergency') {
      const space = await get(`circles/${value.spaceId}`);
      return source.senderId !== value.uid && (source.audience === 'everyone' || (source.audience === 'owner' && source.ownerId === value.uid && space?.ownerId === value.uid));
    }
    if (value.kind === 'message') return source.senderId !== value.uid;
    return Boolean(source.sharing && source.location && now() - source.location.timestamp <= 45000 && source.location.timestamp <= now() + 5000);
  }
  async function deliver(eventId) {
    if (!await active()) return;
    const ref = document(`notificationOutbox/${eventId}`);
    const value = await db.runTransaction(async transaction => {
      const value = (await transaction.get(ref)).data();
      if (!value || value.status === 'sent' || value.status === 'skipped') return null;
      if (millis(value.leaseUntil) > now()) throw Error('Notification is being delivered; retry after its lease expires');
      if (millis(value.expiresAt) <= now()) { transaction.update(ref, { status: 'skipped' }); return null; }
      transaction.update(ref, { leaseUntil: Timestamp.fromMillis(now() + 60000), attempts: FieldValue.increment(1) });
      return value;
    });
    if (!value) return;
    try {
      if (!await stillValid(value)) { await ref.update({ status: 'skipped', leaseUntil: FieldValue.delete() }); return; }
      const endpoints = await db.collection(`users/${value.uid}/pushDevices`).limit(20).get();
      const endpointsValid = endpoints.docs.filter(entry => entry.data().platform === 'android' && typeof entry.data().token === 'string'
        && !(value.sentTokens || []).includes(key(entry.data().token)) && now() - millis(entry.data().updatedAt) <= 90 * 86400000);
      if (!endpointsValid.length) { await ref.update({ status: value.sentTokens?.length ? 'sent' : 'skipped', leaseUntil: FieldValue.delete() }); return; }
      const data = { type: 'closeby', kind: value.kind, eventId, uid: value.uid, spaceId: value.spaceId, resourceId: value.resourceId,
        expiresAt: String(millis(value.expiresAt)), ...(value.deviceId ? { deviceId: value.deviceId } : {}) };
      const result = await messaging.sendEachForMulticast({ tokens: endpointsValid.map(entry => entry.data().token), notification: { title: value.title, body: value.body },
        data, android: { priority: 'high', ttl: Math.max(0, millis(value.expiresAt) - now()), notification: {
          channelId: phoneChannels[value.kind], tag: eventId, sound: value.kind === 'emergency' ? 'closeby_alert' : value.kind === 'call' ? 'closeby_call' : 'default',
          visibility: 'private', defaultVibrateTimings: true, ...(value.kind === 'call' ? { priority: 'max' } : { priority: 'high' }),
        } } });
      let transient = false;
      for (let index = 0; index < result.responses.length; index++) {
        const response = result.responses[index];
        if (response.success) { await ref.update({ sentTokens: FieldValue.arrayUnion(key(endpointsValid[index].data().token)) }); continue; }
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(response.error?.code)) {
          const endpoint = endpointsValid[index];
          await db.runTransaction(async transaction => {
            if ((await transaction.get(endpoint.ref)).data()?.token === endpoint.data().token) transaction.delete(endpoint.ref);
          });
        } else transient = true;
      }
      if (transient) throw Error('Notification provider temporarily unavailable');
      await ref.update({ status: 'sent', sentAt: Timestamp.fromMillis(now()), leaseUntil: FieldValue.delete() });
    } catch (error) { await ref.update({ leaseUntil: FieldValue.delete() }); throw error; }
  }
  return { eventCreated, deviceChanged, deliver, stillValid };
}
module.exports = { createNotificationServer, key };
