const fs = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');

module.exports = config => {
  config = withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    const permissions = ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_CAMERA', 'FOREGROUND_SERVICE_MICROPHONE', 'POST_NOTIFICATIONS', 'WAKE_LOCK', 'MODIFY_AUDIO_SETTINGS'];
    manifest['uses-permission'] ??= [];
    for (const name of permissions) if (!manifest['uses-permission'].some(item => item.$['android:name'] === `android.permission.${name}`)) {
      manifest['uses-permission'].push({ $: { 'android:name': `android.permission.${name}` } });
    }
    const application = manifest.application[0];
    application.service ??= [];
    const name = `${mod.android.package}.MediaSessionService`;
    application.service = application.service.filter(item => item.$['android:name'] !== name);
    application.service.push({ $: { 'android:name': name, 'android:exported': 'false', 'android:stopWithTask': 'false', 'android:foregroundServiceType': 'camera|microphone' } });
    return mod;
  });
  config = withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Closeby media sessions require the Kotlin MainApplication.');
    if (!mod.modResults.contents.includes('add(MediaSessionPackage())')) {
      mod.modResults.contents = mod.modResults.contents.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(MediaSessionPackage())');
      if (!mod.modResults.contents.includes('add(MediaSessionPackage())')) throw new Error('Could not register MediaSessionPackage.');
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const packageName = mod.android.package;
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'));
    await fs.mkdir(target, { recursive: true });
    for (const name of ['MediaSessionService.kt', 'MediaSessionPackage.kt']) {
      const source = await fs.readFile(path.join(__dirname, 'android', name), 'utf8');
      await fs.writeFile(path.join(target, name), source.replaceAll('com.closeby.tracker', packageName));
    }
    return mod;
  }]);
};
