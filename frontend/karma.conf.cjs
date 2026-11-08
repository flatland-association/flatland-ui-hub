// Shared loopback configuration for local and CI dispatcher regressions.
module.exports = config => config.set({
  frameworks: ['jasmine'],
  plugins: ['karma-jasmine', 'karma-chrome-launcher'].map(name => require(name)),
  hostname: '127.0.0.1',
  listenAddress: '127.0.0.1',
  reporters: ['progress'],
  singleRun: true,
  retryLimit: 0,
});
