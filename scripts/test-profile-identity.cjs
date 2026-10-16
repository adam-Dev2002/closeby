const assert = require('node:assert/strict');
const { profileIdentity } = require('../src/lib/profileIdentity.ts');

const google = { providerId: 'google.com', displayName: 'Google member', photoURL: 'https://lh3.googleusercontent.com/profile' };

assert.deepEqual(profileIdentity({ displayName: null, photoURL: null, providerData: [google] }), {
  displayName: google.displayName, photoURL: google.photoURL,
}, 'A linked Google profile supplies a missing name and photo');

assert.deepEqual(profileIdentity({ displayName: 'My profile', photoURL: 'https://example.com/own.jpg', providerData: [google] }), {
  displayName: 'My profile', photoURL: 'https://example.com/own.jpg',
}, 'Explicit account profile fields take priority over linked provider fields');

assert.deepEqual(profileIdentity({ displayName: 'My name', photoURL: null, providerData: [google] }), {
  displayName: 'My name', photoURL: google.photoURL,
}, 'A missing photo does not replace the chosen account name');

assert.deepEqual(profileIdentity({ displayName: ' ', photoURL: ' ', providerData: [google] }), {
  displayName: google.displayName, photoURL: google.photoURL,
}, 'Blank profile fields also use the linked Google profile');

assert.deepEqual(profileIdentity({ providerData: [{ providerId: 'password', photoURL: null }, google] }), {
  displayName: google.displayName, photoURL: google.photoURL,
}, 'Email accounts linked to Google resolve the Google provider regardless of order');

for (const user of [null, undefined, {}, { providerData: [{ providerId: 'password' }] }]) {
  assert.deepEqual(profileIdentity(user), { displayName: null, photoURL: null }, 'Accounts without a photo keep the existing avatar fallback');
}

console.log('PASS: Google-linked and account profile identity cases');
