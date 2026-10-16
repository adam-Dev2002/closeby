const { withGradleProperties } = require('expo/config-plugins');
module.exports = config => withGradleProperties(config, mod => {
  const key = 'AsyncStorage_db_size_in_MB';
  mod.modResults = mod.modResults.filter(item => item.key !== key);
  mod.modResults.push({ type: 'property', key, value: '64' });
  return mod;
});
