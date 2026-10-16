// Uses the developer's existing Firebase CLI login. Never creates a service key
// and never enables billing. --activate is allowed only after deployment is ready.
const fs = require('node:fs'), path = require('node:path');
const base = process.env.FIREBASE_TOOLS_LIB || path.resolve('.verification/firebase/node_modules/firebase-tools/lib');
const project = 'n8n-projects-511018', region = 'asia-southeast1';
const required = ['notifyEmergency', 'notifyCall', 'notifyMessage', 'observeLocations', 'deliverNotification', 'cleanNotificationHistory'];
(async () => {
  const { getGlobalDefaultAccount } = require(path.join(base, 'auth.js'));
  const account = getGlobalDefaultAccount();
  await require(path.join(base, 'requireAuth.js')).requireAuth({ project, user: account?.user, tokens: account?.tokens });
  const { Client } = require(path.join(base, 'apiv2.js'));
  const billing = new Client({ urlPrefix: 'https://cloudbilling.googleapis.com', apiVersion: 'v1' });
  const billingEnabled = (await billing.get(`/projects/${project}/billingInfo`, { skipLog: { resBody: true } })).body.billingEnabled === true;
  let functions = [];
  try { functions = (await new Client({ urlPrefix: 'https://cloudfunctions.googleapis.com', apiVersion: 'v2' }).get(`/projects/${project}/locations/${region}/functions`, { skipLog: { resBody: true } })).body.functions || []; }
  catch { /* A project without the Functions API cannot activate delivery. */ }
  const functionsReady = required.every(name => functions.some(value => value.name.endsWith(`/${name}`) && value.state === 'ACTIVE'));
  const result = { project, billingEnabled, functionsReady, canActivate: billingEnabled && functionsReady, changed: false };
  if (process.argv.includes('--activate') || process.argv.includes('--disable')) {
    const enabled = process.argv.includes('--activate');
    if (enabled && !result.canActivate) throw Error('Delivery cannot be activated: billing-linked hosting and all notification functions must be ready first.');
    await new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' }).patch(`/projects/${project}/databases/(default)/documents/appStatus/notifications`,
      { fields: { enabled: { booleanValue: enabled } } }, { queryParams: { 'updateMask.fieldPaths': 'enabled' }, skipLog: { resBody: true } });
    result.changed = true; result.enabled = enabled;
  }
  fs.mkdirSync('.verification', { recursive: true });
  fs.writeFileSync('.verification/notification-deployment-status.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(String(error.message)); process.exitCode = 1; });
