const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { createNotificationServer } = require('./engine.cjs');

initializeApp();
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 2, concurrency: 10, memory: '256MiB', timeoutSeconds: 120 });
const db = getFirestore(), server = createNotificationServer({ db, messaging: getMessaging(), Timestamp, FieldValue });
const created = (collection, kind) => onDocumentCreated({ document: `circles/{spaceId}/${collection}/{resourceId}`, retry: true }, event => server.eventCreated(event.params.spaceId, kind, event.params.resourceId));
exports.notifyEmergency = created('alerts', 'emergency');
exports.notifyCall = created('calls', 'call');
exports.notifyMessage = created('messages', 'message');
exports.observeLocations = onDocumentWritten({ document: 'circles/{spaceId}/devices/{deviceId}', retry: true }, event => server.deviceChanged(event.params.spaceId, event.params.deviceId));
exports.deliverNotification = onDocumentCreated({ document: 'notificationOutbox/{eventId}', retry: true }, event => server.deliver(event.params.eventId));
exports.cleanNotificationHistory = onSchedule('every 24 hours', async () => {
  // No TTL policy or per-location history collection is required.
  const old = Timestamp.fromMillis(Date.now() - 7 * 86400000);
  const batch = db.batch();
  const jobs = await db.collection('notificationOutbox').where('createdAt', '<', old).limit(400).get();
  jobs.docs.forEach(entry => batch.delete(entry.ref)); await batch.commit();
});
