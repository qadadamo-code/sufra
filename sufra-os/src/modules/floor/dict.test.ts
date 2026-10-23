import { describe, expect, it } from "vitest";
import { floorDict } from "./dict";
import { resDict } from "../reservations/dict";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("floor + reservations copy", () => {
  it("every key has Arabic and English with the same placeholders", () => {
    for (const [k, e] of Object.entries({ ...floorDict, ...resDict }) as [string, { ar: string; en: string }][]) {
      expect(e.ar.trim(), `${k}.ar`).not.toBe("");
      expect(e.en.trim(), `${k}.en`).not.toBe("");
      expect(vars(e.ar), `${k} placeholders`).toEqual(vars(e.en));
    }
  });
  it("has a label for every table state, shape, decor kind, status and tag", () => {
    for (const s of ["free", "reserved", "dirty", "occupied", "long", "bill", "blocked"]) expect(floorDict).toHaveProperty(`state.${s}`);
    for (const s of ["square", "rect", "round", "oval", "booth", "bar"]) expect(floorDict).toHaveProperty(`shape.${s}`);
    for (const s of ["wall", "pillar", "door", "window", "counter", "plant"]) expect(floorDict).toHaveProperty(`decor.${s}`);
    for (const s of ["pending", "confirmed", "seated", "done", "no_show", "cancelled", "waiting"]) expect(resDict).toHaveProperty(`status.${s}`);
    for (const s of ["vip", "birthday", "kids", "quiet", "smoking"]) expect(resDict).toHaveProperty(`tag.${s}`);
  });
});
