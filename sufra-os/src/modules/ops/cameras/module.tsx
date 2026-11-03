import { lazy } from "react";
import { Cctv } from "lucide-react";
import { defineModule } from "../../types";

/**
 * Cameras (owner / admin / manager).
 *   /cameras            live wall (1/4/9/16, fullscreen, per-camera status)
 *   /cameras/events     POS ↔ video exceptions (void, refund, discount above limit, no-sale, cash over/short, manual 86) → open clip
 *   /cameras/occupancy  estimated occupancy per zone (BETA) — manual counts + camera counters
 *   /cameras/setup      camera registry per branch, NVR brand, stream, device/table/drawer links, gateway guide
 */
export default defineModule({
  id: "cameras",
  status: "ready",
  icon: Cctv,
  title: { ar: "الكاميرات", en: "Cameras" },
  description: { ar: "البث المباشر وربط الكاشير بالفيديو والإشغال", en: "Live view, POS ↔ video exceptions and occupancy" },
  permission: "cameras.view",
  shortcut: "g v",
  nav: { path: "/cameras", group: "manage", order: 72 },
  keywords: ["cctv", "camera", "nvr", "hikvision", "dahua", "video", "كاميرا", "كاميرات", "مراقبة", "فيديو"],
  routes: [{ path: "/cameras/*", element: lazy(() => import("./CamerasPage")) }],
  data: ["cameras", "peopleCounts", "auditLog", "opsAcks"],
});
