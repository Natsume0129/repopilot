import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const envPath = resolve(root, ".env");
const dataDir = resolve(root, "data");
mkdirSync(dataDir, { recursive: true });
if (!existsSync(envPath))
  writeFileSync(
    envPath,
    `DATA_DIR=${dataDir.replaceAll("\\", "/")}\nNEXTAUTH_SECRET=${randomBytes(36).toString("base64")}\nNEXTAUTH_URL=http://localhost:3000\nREPOPILOT_MODE=mock\n`,
    { mode: 0o600 },
  );
const contents = readFileSync(envPath, "utf8");
for (const dir of ["apps/web", "apps/workers", "packages/db"]) {
  const target = resolve(root, dir, ".env");
  if (!existsSync(target)) writeFileSync(target, contents, { mode: 0o600 });
}
console.log(
  "Local .env/data prepared; existing files preserved. Next: npx --yes pnpm@11.2.1 db:migrate, then npx --yes pnpm@11.2.1 repopilot:dev. No secrets printed.",
);
