#!/usr/bin/env node
import { main } from '../dist/cli/main.js';

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
