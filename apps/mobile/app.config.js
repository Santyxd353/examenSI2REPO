const base = require('./app.json');

module.exports = () => {
  const config = base.expo;
  if (process.env.APP_VARIANT !== 'qa') return config;
  return {
    ...config,
    name: 'Lúmina QA',
    slug: `${config.slug}-qa`,
    android: {
      ...config.android,
      package: `${config.android.package}.qa`,
    },
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.qa` },
    extra: { ...config.extra, variant: 'qa' },
    plugins: [...(config.plugins ?? []), './plugins/withQaCleartextTraffic'],
  };
};
