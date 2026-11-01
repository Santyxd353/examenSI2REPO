const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Lets the USB-connected QA build access the developer API via `adb reverse`.
 * This plugin is loaded only by the QA variant in app.config.js.
 */
module.exports = function withQaCleartextTraffic(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const application = androidConfig.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return androidConfig;
  });
};
