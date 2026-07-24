#!/usr/bin/env node

process.stderr.write(
  "emit-event has been retired; use `node bin/waymark.mjs event append` so validation and persistence share one authoritative path.\n",
);
process.exitCode = 2;
