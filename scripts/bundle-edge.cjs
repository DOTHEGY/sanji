const esbuild = require("esbuild");
require("fs").mkdirSync("supabase/dashboard", { recursive: true });
esbuild.buildSync({
  entryPoints: ["supabase/functions/workspace/index.ts"],
  bundle: true,
  platform: "neutral",
  format: "esm",
  outfile: "supabase/dashboard/workspace.ts",
  external: ["npm:*", "node:*"],
});
console.log("Single-file Dashboard function prepared.");
