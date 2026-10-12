import { describe, expect, it } from "vitest";
import { levelOf, skylineStats } from "./ContributionSkyline";

describe("ContributionSkyline stats", () => {
  const days = [3, 0, 5, 7, 2, 0, 1, 4].map((count, i) => ({ date: `2026-01-0${i + 1}`, count }));
  it("totals, busiest day and streaks", () => {
    const s = skylineStats(days);
    expect(s.total).toBe(22);
    expect(s.busiest?.date).toBe("2026-01-04");
    expect(s.longest).toBe(3);
    expect(s.current).toBe(2);
  });
  it("levels are quarters of the busiest day", () => {
    expect(levelOf(0, 8)).toBe(0);
    expect(levelOf(1, 8)).toBe(1);
    expect(levelOf(2, 8)).toBe(1);
    expect(levelOf(3, 8)).toBe(2);
    expect(levelOf(8, 8)).toBe(4);
  });
});
