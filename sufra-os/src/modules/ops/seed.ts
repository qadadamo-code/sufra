/**
 * Demo ops data for src/data/seed.ts: cameras for the Zamalek branch (all in DEMO mode — an animated placeholder, never
 * real footage), people-count samples, guest complaints + a Sufra support ticket, ops settings, and a few POS exception
 * audit rows so the camera exceptions list isn't empty. People are fictional.
 */
import type { AuditEntry, Localized } from "@/data/types";
import type { Camera, OpsAck, OpsSettings, PeopleCount, RadioClip, SupportTicket, TicketNote } from "./types";
import { DEFAULT_SLA } from "./support/tickets";
import { DEFAULT_RULES } from "./alerts/alerts";

interface Ctx {
  R: string;
  B: string;
  T: (minutesAgo: number) => string;
  id: (k: string) => string;
  S: (staffKey: string) => string;
  created: string;
  /** table number → id */
  table: (n: number) => string;
  zone: (k: "hall" | "terrace") => string;
  customer: (k: string) => string;
  order: (k: string) => string;
  check: (k: string) => string;
}

export interface OpsSeed {
  cameras: Camera[];
  peopleCounts: PeopleCount[];
  radioClips: RadioClip[];
  supportTickets: SupportTicket[];
  opsSettings: OpsSettings[];
  opsAcks: OpsAck[];
  audit: AuditEntry[];
}

const L = (ar: string, en: string): Localized => ({ ar, en });

export function demoOpsRows(c: Ctx): OpsSeed {
  const base = (k: string) => ({ id: c.id(k), restaurantId: c.R, createdAt: c.created, updatedAt: c.created });
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => c.table(a + i));
  const cam = (k: string, sort: number, name: Localized, area: string, x: Partial<Camera>): Camera => ({
    ...base(`cam:${k}`), branchId: c.B, name, area, zoneId: null, brand: "hikvision", channel: sort, stream: "demo", url: "", snapshotSec: 2,
    posDevices: [], tableIds: [], drawers: [], counter: false, active: true, sort, ...x,
  });
  const cameras: Camera[] = [
    cam("cashier", 1, L("الكاشير", "Cashier"), "الكاشير", { posDevices: ["POS1"], drawers: ["POS1"] }),
    cam("entrance", 2, L("المدخل", "Entrance"), "المدخل", { counter: true, zoneId: c.zone("hall") }),
    cam("hall", 3, L("الصالة — بحري", "Main hall — north"), "الصالة", { zoneId: c.zone("hall"), tableIds: range(1, 6) }),
    cam("hall2", 4, L("الصالة — قبلي", "Main hall — south"), "الصالة", { zoneId: c.zone("hall"), tableIds: range(7, 12), posDevices: ["POS2"], drawers: ["POS2"] }),
    cam("terrace", 5, L("التراس", "Terrace"), "التراس", { zoneId: c.zone("terrace"), tableIds: range(13, 18), counter: true }),
    cam("kitchen", 6, L("المطبخ — الباص", "Kitchen pass"), "المطبخ", { posDevices: ["KDS"] }),
    cam("delivery", 7, L("باب الدليفري", "Delivery door"), "الدليفري", { posDevices: ["RIDER"], brand: "dahua", channel: 1 }),
    cam("store", 8, L("المخزن", "Storeroom"), "المخزن", { brand: "dahua", channel: 2, active: false }),
  ];

  const pc = (k: string, ago: number, zone: "hall" | "terrace", x: Partial<PeopleCount>): PeopleCount => ({
    ...base(`pc:${k}`), createdAt: c.T(ago), updatedAt: c.T(ago), branchId: c.B, zoneId: c.zone(zone), cameraId: null, source: "manual", inCount: 0, outCount: 0, occupancy: null, at: c.T(ago), actorId: c.S("manager"), ...x,
  });
  const peopleCounts: PeopleCount[] = [
    pc("h1", 75, "hall", { occupancy: 22 }),
    pc("h2", 40, "hall", { source: "camera", cameraId: c.id("cam:entrance"), inCount: 9, outCount: 4, actorId: null }),
    pc("h3", 12, "hall", { source: "camera", cameraId: c.id("cam:entrance"), inCount: 6, outCount: 2, actorId: null }),
    pc("t1", 30, "terrace", { occupancy: 11 }),
    pc("t2", 8, "terrace", { source: "camera", cameraId: c.id("cam:terrace"), inCount: 3, outCount: 5, actorId: null }),
  ];

  const note = (k: string, ago: number, by: string | null, byName: string, kind: TicketNote["kind"], text: string): TicketNote => ({ id: c.id(`tnote:${k}`), at: c.T(ago), by: by ? c.S(by) : null, byName, kind, text });
  const tk = (k: string, ago: number, x: Partial<SupportTicket> & Pick<SupportTicket, "kind" | "number" | "subject" | "body">): SupportTicket => ({
    ...base(`ticket:${k}`), createdAt: c.T(ago), updatedAt: c.T(ago), branchId: c.B, category: "other", channel: "qr", priority: "normal", status: "new",
    customerId: null, contactName: "", contactPhone: "", orderId: null, checkId: null, tableId: null, raisedBy: null, assigneeId: null, notes: [], resolution: "",
    followUp: null, followUpAt: null, firstResponseAt: null, resolvedAt: null, escalatedAt: null, diagnostics: null, forwardedAt: null, ...x,
  });
  const supportTickets: SupportTicket[] = [
    tk("g1", 25, {
      kind: "guest", number: "G-1003", subject: "الأكل وصل بارد", body: "الطاجن وصل بارد والرز ناشف، والطيار اتأخر نص ساعة.", category: "delivery", channel: "online", priority: "high",
      customerId: c.customer("1"), contactName: "دينا الشافعي", contactPhone: "01005551201", orderId: c.order("d11"), status: "new",
    }),
    tk("g2", 180, {
      kind: "guest", number: "G-1002", subject: "اتحاسبت على صنف ما طلبتوش", body: "في الفاتورة ٢ كنافة وإحنا طلبنا واحدة بس.", category: "billing", channel: "qr", priority: "high", status: "open",
      customerId: c.customer("4"), contactName: "شريف البنا", contactPhone: "01005551204", checkId: c.check("t7"), tableId: c.table(7), assigneeId: c.S("manager"),
      firstResponseAt: c.T(170), notes: [note("g2a", 170, "manager", "تامر فؤاد", "internal", "راجعت الشيك — فعلاً صنف زيادة. هعمل مرتجع للكنافة التانية."), note("g2b", 168, "manager", "تامر فؤاد", "reply", "آسفين جداً يا أستاذ شريف، هنرجّعلك تمن الكنافة التانية حالاً.")],
    }),
    tk("g3", 60 * 26, {
      kind: "guest", number: "G-1001", subject: "شكر للجرسون", body: "أحمد كان ذوق جداً — شكراً.", category: "praise", channel: "qr", priority: "low", status: "resolved",
      customerId: c.customer("2"), contactName: "عمرو حجازي", contactPhone: "01005551202", firstResponseAt: c.T(60 * 25), resolvedAt: c.T(60 * 25), resolution: "اتبلّغ أحمد وشكرناه.", followUp: "شكراً لكلامك الحلو يا أستاذ عمرو — مستنيينك تاني!", followUpAt: c.T(60 * 25),
    }),
    tk("s1", 60 * 5, {
      kind: "sufra", number: "S-0001", subject: "طابعة المطبخ مش بتطبع التيكت العربي", body: "التيكت بيطلع حروف غريبة على طابعة المطبخ (Xprinter 80mm) من امبارح.", category: "printer", channel: "app", priority: "normal", status: "pending",
      raisedBy: c.S("chef"), contactName: "الشيف صابر", contactPhone: "01005550109", firstResponseAt: c.T(60 * 4),
      notes: [note("s1a", 60 * 4, "platform", "دعم سُفرة", "reply", "أهلاً يا شيف — جرّب من الإعدادات ← الطابعات تخلي وضع الطباعة «صورة (Raster)» بدل «نص». لو فضلت المشكلة ابعتلنا صورة التيكت.")],
    }),
  ];

  const opsSettings: OpsSettings[] = [{
    ...base("ops-settings"),
    hotlinePhone: "0227350000", whatsappPhone: "01005550103", sufraSupportPhone: "", sufraSupportWhatsapp: "",
    gatewayUrl: "", playbackTemplates: {}, nvrHost: "192.168.1.64:554", clipPadSec: 30,
    zoneCapacity: { [c.zone("hall")]: 60, [c.zone("terrace")]: 36 },
    sla: DEFAULT_SLA, alertRules: DEFAULT_RULES, radio: { maxClipSec: 30, minClipMs: 400, autoplay: true },
  }];

  const au = (k: string, ago: number, actor: string | null, action: string, entity: string, entityId: string | null, data: Record<string, unknown>, approvedBy: string | null = null): AuditEntry => ({
    ...base(`audit:ops:${k}`), createdAt: c.T(ago), updatedAt: c.T(ago), branchId: c.B, actorId: actor ? c.S(actor) : null, action, entity, entityId, data, approvedBy: approvedBy ? c.S(approvedBy) : null,
  });
  const audit: AuditEntry[] = [
    au("void1", 34, "cashier1", "order.void", "orderItems", null, { device: "POS1", item: "Mixed grill", qty: 1, reason: "العميل غيّر رأيه", tableIds: [c.table(7)] }, "manager"),
    au("nosale1", 52, "cashier1", "drawer.open", "cashMovements", null, { device: "POS1", amount: 0, reason: "فكة للطيار" }, "manager"),
    au("disc1", 66, "waiter2", "check.discount", "checks", c.check("t3"), { device: "POS2", discount: { kind: "percent", rate: 2500 }, reason: "صاحب صاحب المطعم", tableIds: [c.table(3)] }, "manager"),
    au("refund1", 140, "cashier2", "payment.refund", "receipts", null, { device: "POS1", total: 18_500_000, method: "cash", reason: "طبق اترجع" }, "manager"),
    au("86a", 95, "chef", "menu.86", "menuItems", null, { item: "Lamb shank" }),
    au("close1", 60 * 7, "cashier2", "shift.close", "shifts", null, { device: "POS1", zNumber: 41, expected: 1_254_000_000, counted: 1_249_000_000, difference: -5_000_000 }),
  ];

  return { cameras, peopleCounts, radioClips: [], supportTickets, opsSettings, opsAcks: [], audit };
}
