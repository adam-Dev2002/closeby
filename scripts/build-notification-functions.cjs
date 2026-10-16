const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'functions/lib'), { recursive: true });
for (const name of ['placePresence', 'speedAlerts', 'phoneNotifications']) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, `src/lib/${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  if (result.diagnostics?.some(value => value.category === ts.DiagnosticCategory.Error)) throw Error(`Cannot compile ${name}`);
  fs.writeFileSync(path.join(root, `functions/lib/${name}.cjs`), result.outputText);
}
console.log('Built the shared notification, arrival and speed evaluators for Node.');
