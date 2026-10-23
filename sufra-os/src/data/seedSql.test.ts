import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seedSql } from "./seedSql";

describe("supabase/seed.sql", () => {
  it("is in sync with src/data/seed.ts (run `npm run gen:seed`)", () => {
    const file = readFileSync(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
    expect(file).toBe(seedSql());
  });
});
