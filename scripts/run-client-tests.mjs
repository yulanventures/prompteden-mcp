import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import * as esbuild from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "prompteden-client-test-"));
const outfile = join(dir, "client.test.mjs");

try {
  await esbuild.build({
    entryPoints: ["src/api-client/client.test.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });

  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", outfile], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (status) => resolve(status ?? 1));
  });
  process.exit(code);
} finally {
  await rm(dir, { recursive: true, force: true });
}
