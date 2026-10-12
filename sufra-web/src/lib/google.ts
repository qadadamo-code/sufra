/**
 * Google Maps Platform — only active when VITE_GOOGLE_MAPS_KEY is set at build time.
 * Without a key nothing here runs: no Google map, no Google ratings, no Google sort (we never show made-up numbers).
 * The key is a browser key: restrict it to your domain(s) (HTTP referrers) and to Maps JavaScript API + Places API (New).
 */
import { useEffect, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import type { Restaurant } from "./data";
import { haversineKm } from "./geo";

export const GOOGLE_KEY: string = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined)?.trim() ?? "";
export const hasGoogleKey = GOOGLE_KEY.length > 10;

let loading: Promise<{ maps: google.maps.MapsLibrary; marker: google.maps.MarkerLibrary } & { maps: typeof google.maps }> | null = null;
export function loadGoogle(lang: "ar" | "en") {
  if (!hasGoogleKey) return Promise.reject(new Error("no key"));
  if (!loading) {
    setOptions({ key: GOOGLE_KEY, v: "weekly", language: lang, region: "EG" });
    loading = new Promise((resolve, reject) => {
      // Google calls this global when the key is rejected (referrer/billing) — treat it as a load failure
      (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => reject(new Error("google auth failure"));
      Promise.all([importLibrary("maps"), importLibrary("marker")])
        .then(([, marker]) => resolve({ maps: google.maps, marker } as never))
        .catch(reject);
    });
  }
  return loading;
}

export interface GoogleRating {
  rating: number;
  count: number;
  url: string | null;
  name: string;
}

const cache = new Map<string, GoogleRating | null>();
const SS = "sufra.grating.";

/** Live Google rating for one place: Places API (New) text search by name, biased to its coordinates. */
export async function fetchGoogleRating(r: Restaurant, lang: "ar" | "en", signal?: AbortSignal): Promise<GoogleRating | null> {
  if (!hasGoogleKey) return null;
  if (cache.has(r.id)) return cache.get(r.id)!;
  try {
    const s = sessionStorage.getItem(SS + r.id);
    if (s) {
      const v = JSON.parse(s) as GoogleRating | null;
      cache.set(r.id, v);
      return v;
    }
  } catch {
    /* storage blocked */
  }
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.location",
      },
      body: JSON.stringify({
        textQuery: r.en || r.ar,
        languageCode: lang,
        regionCode: "EG",
        maxResultCount: 3,
        locationBias: { circle: { center: { latitude: r.lat, longitude: r.lng }, radius: 400 } },
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { places?: { displayName?: { text?: string }; rating?: number; userRatingCount?: number; googleMapsUri?: string; location?: { latitude: number; longitude: number } }[] };
    // only trust a result that is actually where our place is (≤ 250 m)
    const hit = j.places?.find((p) => p.location && typeof p.rating === "number" && haversineKm({ lat: p.location.latitude, lng: p.location.longitude }, r) <= 0.25);
    const out: GoogleRating | null = hit ? { rating: hit.rating!, count: hit.userRatingCount ?? 0, url: hit.googleMapsUri ?? null, name: hit.displayName?.text ?? r.en } : null;
    cache.set(r.id, out);
    try {
      sessionStorage.setItem(SS + r.id, JSON.stringify(out));
    } catch {
      /* ignore */
    }
    return out;
  } catch {
    return null;
  }
}

export function useGoogleRating(r: Restaurant | null, lang: "ar" | "en") {
  const [v, setV] = useState<{ state: "off" | "loading" | "ok" | "none"; data: GoogleRating | null }>({ state: hasGoogleKey ? "loading" : "off", data: null });
  useEffect(() => {
    if (!hasGoogleKey || !r) return;
    const ac = new AbortController();
    setV({ state: "loading", data: null });
    fetchGoogleRating(r, lang, ac.signal).then((d) => !ac.signal.aborted && setV({ state: d ? "ok" : "none", data: d }));
    return () => ac.abort();
  }, [r, lang]);
  return v;
}
