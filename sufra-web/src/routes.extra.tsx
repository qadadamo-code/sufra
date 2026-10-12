/**
 * Extra routes registered by the B2B side (restaurant + supplier). The main router (App.tsx) should check these
 * BEFORE its own switch:
 *
 *   const extra = matchExtraRoute(route.path);
 *   if (extra) return <Suspense fallback={<Loading />}><extra.Component route={route} /></Suspense>;
 *
 * Each page renders its own chrome (header/footer), so the router must not wrap it in the customer Header/BottomNav.
 * Order matters: the first entry whose `path` matches wins (`prefix: true` also matches sub-paths).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Route } from "@/lib/router";

export interface ExtraRoute {
  path: string;
  prefix?: boolean;
  Component: LazyExoticComponent<ComponentType<{ route: Route }>>;
}

export const extraRoutes: ExtraRoute[] = [
  { path: "/business/pricing", Component: lazy(() => import("@/pages/business/Pricing")) },
  { path: "/business/signup", Component: lazy(() => import("@/pages/business/Signup")) },
  { path: "/business/dashboard", prefix: true, Component: lazy(() => import("@/pages/business/Dashboard")) },
  { path: "/business/revenue", Component: lazy(() => import("@/pages/business/Revenue")) },
  { path: "/business", Component: lazy(() => import("@/pages/business/Landing")) },
  { path: "/suppliers/portal", prefix: true, Component: lazy(() => import("@/pages/supplier/Portal")) },
  { path: "/suppliers/signup", Component: lazy(() => import("@/pages/supplier/Signup")) },
  { path: "/suppliers", Component: lazy(() => import("@/pages/supplier/Landing")) },
];

export function matchExtraRoute(path: string): ExtraRoute | undefined {
  const p = path.replace(/\/+$/, "") || "/";
  return extraRoutes.find((r) => p === r.path || (r.prefix && p.startsWith(r.path + "/")));
}
