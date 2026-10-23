// npm run gen:seed — writes supabase/seed.sql from src/data/seed.ts
process.env.TZ = "Africa/Cairo";
const { seedSql } = await import("../src/data/seedSql");
const fs = await import("node:fs");
fs.writeFileSync(new URL("../supabase/seed.sql", import.meta.url), seedSql());
console.log("wrote supabase/seed.sql");
