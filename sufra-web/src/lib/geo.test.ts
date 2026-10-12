import { describe, expect, it } from "vitest";
import { directionsUrl, fmtKm, haversineKm, travel } from "./geo";
import { inCairo, nearestArea, photonLabel } from "./location";
import { busyHint } from "./smart-notify";
import { restaurants } from "./data";

describe("distance & time", () => {
  it("haversine is symmetric and sane across Cairo", () => {
    const zamalek = { lat: 30.0626, lng: 31.2197 }, newCairo = { lat: 30.0074, lng: 31.4913 };
    expect(haversineKm(zamalek, newCairo)).toBeCloseTo(haversineKm(newCairo, zamalek), 9);
    expect(haversineKm(zamalek, newCairo)).toBeGreaterThan(25);
    expect(haversineKm(zamalek, newCairo)).toBeLessThan(30);
  });
  it("walking only under 2 km; car adds parking time", () => {
    expect(travel(0)).toEqual({ car: 4, walk: 1 });
    expect(travel(1.9).walk).toBe(24);
    expect(travel(2.1).walk).toBeNull();
    expect(travel(22).car).toBe(64);
  });
  it("formats km", () => {
    expect(fmtKm(0.42, "en")).toBe("0.4 km");
    expect(fmtKm(12.6, "ar")).toBe("13 كم");
  });
  it("directions link carries origin, destination and mode", () => {
    const u = directionsUrl({ lat: 30.05, lng: 31.23 }, { lat: 30.06, lng: 31.22 }, "walking");
    expect(u).toContain("https://www.google.com/maps/dir/?api=1");
    expect(u).toContain("origin=30.050000,31.230000");
    expect(u).toContain("destination=30.060000,31.220000");
    expect(u).toContain("travelmode=walking");
    expect(directionsUrl(null, { lat: 1, lng: 2 })).not.toContain("origin=");
  });
});

describe("location helpers", () => {
  it("nearest area and Cairo bounds", () => {
    expect(nearestArea({ lat: 30.061, lng: 31.221 }).id).toBe("zamalek");
    expect(inCairo({ lat: 30.06, lng: 31.22 })).toBe(true);
    expect(inCairo({ lat: 31.2, lng: 29.9 })).toBe(false); // Alexandria
  });
  it("Photon properties → short readable label", () => {
    expect(photonLabel({ name: "Cairo Tower", district: "Zamalek", city: "Cairo" })).toBe("Cairo Tower، Zamalek");
    expect(photonLabel({ street: "شارع التحرير", housenumber: "62", city: "الجيزة" })).toBe("شارع التحرير 62، الجيزة");
    expect(photonLabel({})).toBeNull();
    expect(photonLabel(null)).toBeNull();
  });
});

describe("busy hint", () => {
  it("suggests a clearly quieter hour later today when it's busy now", () => {
    const r = { ...restaurants[0], hours: Array.from({ length: 7 }, () => [600, 1439] as [number, number]), busy: Array.from({ length: 24 }, (_, h) => (h === 20 ? 90 : h === 22 ? 30 : 75)) };
    const h = busyHint(r, new Date(2026, 9, 12, 20, 10))!;
    expect(h.level).toBe("busy");
    expect(h.quietAt).toBe(22 * 60);
    expect(busyHint(r, new Date(2026, 9, 12, 8))).toBeNull(); // closed → no hint
  });
});
