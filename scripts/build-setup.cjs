const fs = require("node:fs");
const source = fs.readFileSync(
  "supabase/migrations/202610210001_workspace.sql",
  "utf8",
);
const a = source.indexOf(
    "create or replace function public.sanji_save_record(",
  ),
  b = source.indexOf("create or replace function public.sanji_manage_thread(");
if (a < 0 || b < a) throw Error("SQL boundaries not found");
const parts = [
  source.slice(0, a) + "\ncommit;",
  "begin;\n" + source.slice(a, b) + "\ncommit;",
  "begin;\n" + source.slice(b),
];
fs.mkdirSync("public/setup", { recursive: true });
parts.forEach((text, i) =>
  fs.writeFileSync(
    `public/setup/0${i + 1}.sql`,
    `-- SANJI STEP ${i + 1} START\n${text}\n-- SANJI STEP ${i + 1} COMPLETE\n`,
  ),
);
fs.writeFileSync(
  "public/setup/owner.sql",
  fs.readFileSync("supabase/OWNER.template.sql", "utf8"),
);
fs.writeFileSync(
  "public/setup/automation.sql",
  fs.readFileSync("supabase/migrations/202610210002_automation.sql", "utf8"),
);
fs.mkdirSync("public/connect", { recursive: true });
fs.copyFileSync(
  "supabase/dashboard/workspace.ts",
  "public/connect/workspace.ts",
);

fs.copyFileSync("web/edge-diagnostics.js", "public/connect/diagnostics.js");

fs.copyFileSync("supabase/migrations/202610210003_discovery.sql", "public/setup/discovery.sql");

fs.copyFileSync("supabase/migrations/202610220001_mail_refresh.sql", "public/setup/mail-refresh.sql");

fs.copyFileSync("supabase/migrations/202610220002_mail_operations.sql", "public/setup/mail-operations.sql");

fs.copyFileSync("supabase/migrations/202610220003_search_refill.sql", "public/setup/search-refill.sql");
