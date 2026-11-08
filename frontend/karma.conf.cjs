// Shared loopback configuration for local and CI dispatcher regressions.
module.exports = config => config.set({
  frameworks: ['jasmine'],
  plugins: ['karma-jasmine', 'karma-chrome-launcher'].map(name => require(name)),
  hostname: '127.0.0.1',
  listenAddress: '127.0.0.1',
  reporters: ['progress'],
  singleRun: true,
  retryLimit: 0,
  customLaunchers: {
    // GitHub's Ubuntu runners disable unprivileged user namespaces, so Chrome's
    // sandbox cannot start there ("No usable sandbox!"). A fixed window keeps
    // the overlay's layout specs independent of the headless default size.
    ChromeHeadlessCI: { base: 'ChromeHeadless', flags: ['--no-sandbox', '--window-size=1440,900'] },
  },
});
