// Launch an ISOLATED, empty demo platform for recording / screenshots.
//
// It uses its OWN database and port, so the live platform on 4319 and ALL of its
// real data (real conversations, internal comms) are completely untouched —
// nothing private can leak into a demo, and production data can't be lost here.
//
//   npm run demo                                  -> http://127.0.0.1:4400 (fresh)
//   then drive it with a demo agent:
//   PowerShell:  $env:PLATFORM_URL='http://127.0.0.1:4400'; npm run sim
//   bash:        PLATFORM_URL=http://127.0.0.1:4400 npm run sim
//
// Reset the demo to an empty slate any time by deleting data/demo.db (and its
// -wal / -shm files). The live data/beacon.db is never touched by this script.
//
// Override the defaults if needed: DEMO_PORT / DEMO_DB.
process.env.PORT = process.env.DEMO_PORT ?? process.env.PORT ?? '4400';
process.env.BEACON_DB = process.env.DEMO_DB ?? process.env.BEACON_DB ?? 'data/demo.db';

console.log(
  `[demo] starting an ISOLATED demo platform — db=${process.env.BEACON_DB} port=${process.env.PORT} ` +
    `(live data/beacon.db on 4319 is untouched)`,
);

// Import the gateway AFTER the env is set: it reads PORT at load and the store
// opens BEACON_DB at import, so both must be in place first.
await import('../src/server/index');

export {}; // make this file a module so the top-level await above is allowed
