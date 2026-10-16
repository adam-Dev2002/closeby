const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  // Portable SDKs and isolated test dependencies are not app source modules.
  /[/\\](?:\.tools|\.verification|\.npm-cache)[/\\]/,
];

module.exports = config;
