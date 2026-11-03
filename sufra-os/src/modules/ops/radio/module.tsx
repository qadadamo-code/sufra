import { lazy } from "react";
import { RadioTower } from "lucide-react";
import { defineModule } from "../../types";
import { useRadioBadge } from "./badge";

/** Walkie-talkie / push-to-talk for every restaurant role (phone-first). The floating PTT button lives in ops/shell.tsx. */
export default defineModule({
  id: "radio",
  status: "ready",
  icon: RadioTower,
  title: { ar: "واكي توكي", en: "Walkie-talkie" },
  description: { ar: "اضغط واتكلم: الصالة والمطبخ والدليفري والإدارة", en: "Push-to-talk: floor, kitchen, delivery and managers" },
  permission: "radio.use",
  shortcut: "g l",
  nav: { path: "/radio", group: "service", order: 95, mobile: true, useBadge: useRadioBadge },
  keywords: ["radio", "ptt", "walkie", "talkie", "push to talk", "لاسلكي", "واكي", "توكي", "صوت"],
  routes: [{ path: "/radio", element: lazy(() => import("./RadioPage")) }],
  data: ["radioClips", "memberships"],
});
