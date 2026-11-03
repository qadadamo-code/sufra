/**
 * Live location while the rider is on shift: `navigator.geolocation.watchPosition`, throttled (see `shouldSend`) and
 * battery-friendly — high accuracy only while an order is on the road, coarse fixes while waiting at the kitchen;
 * the watch stops when the shift ends or the page unmounts.
 */
import { useEffect, useRef, useState } from "react";
import type { Db } from "@/data/hooks";
import { saveLocation, shouldSend, type Fix } from "./driverOps";

export type GpsState = "off" | "waiting" | "sharing" | "denied" | "unavailable";

export function useRiderGps(db: Db, driverId: string | null, on: boolean, precise: boolean): { state: GpsState; last: Fix | null } {
  const [state, setState] = useState<GpsState>("off");
  const [last, setLast] = useState<Fix | null>(null);
  const sent = useRef<Fix | null>(null);
  useEffect(() => {
    if (!on || !driverId) {
      setState("off");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }
    setState("waiting");
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const f: Fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null, heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null, speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null, at: pos.timestamp || Date.now() };
        setLast(f);
        setState("sharing");
        if (shouldSend(sent.current, f)) {
          sent.current = f;
          void saveLocation(db, driverId, f, true).catch(() => undefined);
        }
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: precise, maximumAge: precise ? 5_000 : 30_000, timeout: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [db, driverId, on, precise]);
  return { state, last };
}
