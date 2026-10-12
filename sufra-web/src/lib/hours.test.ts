import { describe, expect, it } from "vitest";
import { fmtTime, openDuring, openState, timeSlots } from "./hours";
import { haversineKm, travel } from "./geo";

const week = (o: number, c: number) => Array.from({ length: 7 }, () => [o, c] as [number, number]);
// 2026-10-12 is a Monday (getDay() = 1)
const at = (h: number, m = 0) => new Date(2026, 9, 12, h, m);

describe("openState", () => {
  it("is open inside today's hours", () => {
    expect(openState(week(540, 1380), at(12)).open).toBe(true);
    expect(openState(week(540, 1380), at(8)).open).toBe(false);
    expect(openState(week(540, 1380), at(8)).in).toBe(60);
  });
  it("counts yesterday's after-midnight tail", () => {
    const s = openState(week(780, 1560), at(1, 30)); // closes 02:00
    expect(s.open).toBe(true);
    expect(s.in).toBe(30);
    expect(s.closingSoon).toBe(true);
  });
  it("after close points to tomorrow", () => {
    const s = openState(week(540, 1380), at(23, 30));
    expect(s.open).toBe(false);
    expect(s.at).toBe(540);
  });
});

describe("helpers", () => {
  it("formats times with Latin digits", () => {
    expect(fmtTime(1530, "ar")).toBe("1:30 ص");
    expect(fmtTime(810, "en")).toBe("1:30 PM");
  });
  it("time-of-day overlap", () => {
    expect(openDuring(week(780, 1560), "late", 1)).toBe(true);
    expect(openDuring(week(420, 1380), "late", 1)).toBe(false);
    expect(openDuring(week(420, 1380), "morning", 1)).toBe(true);
  });
  it("slots stop an hour before close and skip the past", () => {
    const s = timeSlots(week(540, 1380), at(9), at(20));
    expect(s[0]).toBe(1230); // now 20:00 + 30 min lead → first slot 20:30
    expect(s[s.length - 1]).toBe(1320);
  });
  it("distance + travel time", () => {
    const km = haversineKm({ lat: 30.0626, lng: 31.2197 }, { lat: 30.0444, lng: 31.2357 });
    expect(km).toBeGreaterThan(2);
    expect(km).toBeLessThan(3);
    expect(travel(11)).toEqual({ car: 34, walk: null });
    expect(travel(1.2).walk).toBe(15);
  });
});
