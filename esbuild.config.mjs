// Produces one self-contained executable (dist/index.mjs) that bundles the
// MCP SDK, the API client, the tool registry, and zod. The published package
// runs with no node_modules present.
import { chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const outfile = join(root, 'dist', 'index.mjs');

mkdirSync(join(root, 'dist'), { recursive: true });

await esbuild.build({
  entryPoints: [join(root, 'src', 'index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Node built-ins are resolved at runtime; everything else (SDK, api-client,
  // zod) is inlined so the file runs standalone.
  packages: 'bundle',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'info',
});

// Make the single-file bundle directly executable for the `bin` entry.
chmodSync(outfile, 0o755);

process.stdout.write(`bundled -> ${outfile}\n`);
