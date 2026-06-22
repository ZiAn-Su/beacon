// pm2 process config for the Beacon platform.
//
// Run it with:
//   pm2 start ecosystem.config.cjs        # start under pm2 (once)
//   pm2 restart beacon                    # deploy = one command, no terminal
//   pm2 logs beacon                       # tail logs
//
// Why a config file instead of `pm2 start npm -- run platform`: on Windows pm2
// can't drive the `npm.cmd` wrapper in fork mode (it errors / restart-loops).
// Here we launch the tsx CLI directly with node — no .cmd wrapper, cross-platform.
const { join } = require('node:path');

module.exports = {
  apps: [
    {
      name: 'beacon',
      script: join(__dirname, 'node_modules/tsx/dist/cli.mjs'),
      args: ['src/server/index.ts'],
      interpreter: 'node',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      // Uncomment to pin a port (defaults to 4319):
      // env: { PORT: '4319' },
    },
  ],
};
