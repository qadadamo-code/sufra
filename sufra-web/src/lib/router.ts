import { useEffect, useState } from "react";

export type Route = { path: string; parts: string[]; query: URLSearchParams };

function parse(): Route {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [p, q = ""] = h.split("?");
  const path = p.startsWith("/") ? p : "/" + p;
  return { path, parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(to: string, { replace = false } = {}) {
  const hash = to.startsWith("#") ? to : "#" + to;
  if (replace) window.history.replaceState(null, "", hash);
  else window.location.hash = hash;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Absolute shareable URL for a route (works from any subpath). */
export function shareUrl(path: string) {
  const base = window.location.href.split("#")[0];
  return `${base}#${path}`;
}
