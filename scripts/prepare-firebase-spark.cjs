const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const specification = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8'));
// Spark does not support TTL deletion. Keep all query indexes and field exemptions.
specification.fieldOverrides = specification.fieldOverrides.map(({ ttl, ...field }) => field);
fs.mkdirSync(path.join(root, '.verification'), { recursive: true });
fs.writeFileSync(path.join(root, '.verification/firestore.spark.indexes.json'), JSON.stringify(specification, null, 2) + '\n');
console.log('Prepared Spark indexes without a billable TTL policy.');
