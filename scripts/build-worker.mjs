import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
await build({
  entryPoints: ["server/worker.ts"],
  outfile: "dist/_worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  define: { "import.meta.env.DEV": "false" },
});
await writeFile(
  "dist/_routes.json",
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2),
);
