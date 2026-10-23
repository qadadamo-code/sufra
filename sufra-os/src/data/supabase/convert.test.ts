import { describe, expect, it } from "vitest";
import { rowFromDb, rowToDb, toCamel, toSnake } from "./SupabaseAdapter";

describe("supabase row conversion", () => {
  it("maps keys both ways, top level only", () => {
    expect(toSnake("restaurantId")).toBe("restaurant_id");
    expect(toCamel("modifier_group_ids")).toBe("modifierGroupIds");
    const db = rowToDb({ restaurantId: "r", hasPin: true, modifiers: [{ groupId: "g" }], undefinedKey: undefined });
    expect(db).toEqual({ restaurant_id: "r", modifiers: [{ groupId: "g" }] });
    expect(rowFromDb<{ statusSince: string }>({ status_since: "x" }).statusSince).toBe("x");
  });
});
