import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

import * as esbuild from "esbuild";

await mkdir("build", { recursive: true });
const dir = await mkdtemp(join("build", "prompteden-test-"));

try {
  await esbuild.build({
    entryPoints: ["src/api-client/client.test.ts", "src/tools.test.ts"],
    outdir: dir,
    outbase: "src",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });

  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", join(dir, "api-client/client.test.js"), join(dir, "tools.test.js")], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (status) => resolve(status ?? 1));
  });
  process.exitCode = code;
} finally {
  await rm(dir, { recursive: true, force: true });
}
