import type { Localized } from "@/data/types";

export const ROLES = ["owner", "admin", "manager", "cashier", "waiter", "chef", "kitchen", "delivery", "accountant"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, Localized> = {
  owner: { ar: "صاحب المطعم", en: "Owner" },
  admin: { ar: "أدمن", en: "Admin" },
  manager: { ar: "مدير الصالة", en: "Floor manager" },
  cashier: { ar: "كاشير", en: "Cashier" },
  waiter: { ar: "جرسون", en: "Waiter" },
  chef: { ar: "شيف", en: "Chef" },
  kitchen: { ar: "مطبخ", en: "Kitchen" },
  delivery: { ar: "دليفري", en: "Delivery" },
  accountant: { ar: "محاسب", en: "Accountant" },
};

/** Where each role lands after login. Modules can claim a role with `homeFor` in their definition. */
export const ROLE_HOME: Record<Role, string> = {
  owner: "/overview",
  admin: "/overview",
  manager: "/floor",
  cashier: "/pos",
  waiter: "/waiter",
  chef: "/kitchen",
  kitchen: "/kitchen",
  delivery: "/delivery",
  accountant: "/accounting",
};

/** Roles that typically sign in with email (own device); everyone can also use a PIN on shared devices. */
export const EMAIL_ROLES: Role[] = ["owner", "admin", "manager", "accountant"];

/** Rank for "manager or above" approvals. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 100,
  admin: 90,
  manager: 70,
  accountant: 40,
  chef: 40,
  cashier: 30,
  waiter: 20,
  kitchen: 20,
  delivery: 10,
};
