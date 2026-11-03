/**
 * Demo inbox for the seeded restaurant (all names and numbers fictional — same customers as src/data/seed.ts).
 * Called from buildSeed(); deterministic ids so the demo looks the same every reset.
 */
import type { Conversation, Message, MessagingConsent } from "@/data/types";
import { estimateCostMicros, toE164 } from "./core";

interface Ctx {
  restaurantId: string;
  /** minutes ago → ISO */
  T: (minutesAgo: number) => string;
  id: (key: string) => string;
  customerId: (k: string) => string;
  staffId: (k: string) => string;
  orderId: (k: string) => string;
}

export function demoMessagingRows(c: Ctx): { conversations: Conversation[]; messages: Message[]; messagingConsents: MessagingConsent[] } {
  const R = c.restaurantId;
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const messagingConsents: MessagingConsent[] = [];

  type M = [minutesAgo: number, dir: "in" | "out", body: string, extra?: Partial<Message>];
  const convo = (k: string, name: string, phone: string, cust: string | null, msgs: M[], extra: Partial<Conversation> = {}) => {
    const e164 = toE164(phone)!;
    const cid = c.id(`wa:conv:${k}`);
    const rows: Message[] = msgs.map(([ago, dir, body, x], i) => ({
      id: c.id(`wa:msg:${k}:${i}`),
      restaurantId: R,
      createdAt: c.T(ago),
      updatedAt: c.T(ago),
      conversationId: cid,
      direction: dir,
      channel: dir === "in" ? "whatsapp" : "click_to_chat",
      kind: "text",
      template: null,
      lang: "ar",
      category: dir === "out" ? "service" : null,
      body,
      params: {},
      media: null,
      status: dir === "in" ? "received" : "opened",
      providerId: dir === "in" ? `wamid.demo.${k}.${i}` : null,
      error: null,
      sentBy: dir === "out" ? c.staffId("cashier1") : null,
      sendAt: null,
      sentAt: dir === "out" ? c.T(ago) : null,
      deliveredAt: null,
      readAt: null,
      orderId: null,
      dedupeKey: null,
      costMicros: 0,
      ...x,
    }));
    messages.push(...rows);
    const inbound = rows.filter((m) => m.direction === "in");
    const last = rows[rows.length - 1];
    const firstUnread = rows.findIndex((m, i) => m.direction === "in" && rows.slice(i).every((x) => x.direction === "in"));
    conversations.push({
      id: cid,
      restaurantId: R,
      createdAt: rows[0].createdAt,
      updatedAt: last.createdAt,
      phone: e164,
      name,
      customerId: cust ? c.customerId(cust) : null,
      status: "open",
      assignedTo: null,
      unread: firstUnread >= 0 ? rows.length - firstUnread : 0,
      lastMessageAt: last.createdAt,
      lastInboundAt: inbound.length ? inbound[inbound.length - 1].createdAt : null,
      lastPreview: last.body.slice(0, 120),
      lastAutoReplyAt: null,
      tags: [],
      ...extra,
    });
    return cid;
  };

  const tpl = (template: string, category: Message["category"], phone: string): Partial<Message> => ({
    kind: "template",
    template,
    category,
    channel: "whatsapp",
    status: "read",
    costMicros: estimateCostMicros(category === "marketing" ? "marketing" : "utility", toE164(phone)!),
  });

  convo("dina", "دينا الشافعي", "01005551201", "1", [
    [26 * 60, "out", "أهلاً دينا 👋 حجزك النهارده الساعة ٨:٣٠ لـ ٤ أفراد اتأكد ✅", tpl("reservation_confirmed", "utility", "01005551201")],
    [14, "in", "تمام شكرًا 🙏 ممكن الترابيزة اللي جنب الشباك في التراس؟"],
    [13, "in", "وكمان هيبقى معانا طفل صغير، ممكن كرسي أطفال؟"],
  ]);

  convo("osama", "أسامة جلال", "01005551208", "8", [
    [33, "out", "طلبك #12 وصلنا يا أسامة 👋 الإجمالي ٦٤٥ ج.م — كاش عند الاستلام", { ...tpl("order_received", "utility", "01005551208"), orderId: c.orderId("d1"), dedupeKey: `${c.orderId("d1")}:received` }],
    [21, "out", "طلبك #12 خرج مع الطيار إسلام 🛵 هيوصلك حوالي ٩:٠٥", { ...tpl("order_out_for_delivery", "utility", "01005551208"), status: "delivered", orderId: c.orderId("d1"), dedupeKey: `${c.orderId("d1")}:out_for_delivery` }],
    [6, "in", "الطيار فين؟ بقاله ربع ساعة مكانش باين على الخريطة"],
  ], { assignedTo: c.staffId("cashier1") });

  convo("omar", "عمرو حجازي", "01005551202", "2", [
    [3 * 60, "in", "عندكم فرع في المعادي؟"],
    [3 * 60 - 4, "out", "لسه يا عمرو، بس بنوصّل المعادي من الزمالك 🛵 رسوم التوصيل ٤٥ ج.م"],
    [3 * 60 - 6, "in", "تمام هطلب بالليل إن شاء الله"],
    [3 * 60 - 7, "out", "في انتظارك 🌿 المنيو: https://sufra-planet-crm.vercel.app/app/r/sufra-zamalek"],
  ]);

  convo("rana", "رنا عزت", "01005551209", "9", [
    [2 * 24 * 60, "out", "وحشتنا يا رنا 💚 خصم ٢٠٪ على أي طاجن بالكود BACK20", tpl("win_back_offer", "marketing", "01005551209")],
    [2 * 24 * 60 - 30, "in", "وقف"],
    [2 * 24 * 60 - 30, "out", "تم إلغاء اشتراكك في رسايل العروض ✅ ابعت «اشتراك» لو حبيت ترجع.", { kind: "system", channel: "whatsapp", status: "read" }],
  ]);

  convo("ksa", "Faisal Al-Harbi", "0551234567", null, [[50, "in", "Hello, do you deliver to Riyadh? 😄"]]);

  /* consent */
  const consent = (k: string, phone: string, cust: string | null, status: MessagingConsent["status"], source: MessagingConsent["source"], ago: number, wording: string, history?: MessagingConsent["history"]): void => {
    messagingConsents.push({
      id: c.id(`wa:consent:${k}`), restaurantId: R, createdAt: c.T(ago), updatedAt: c.T(ago),
      phone: toE164(phone)!, customerId: cust ? c.customerId(cust) : null, channel: "whatsapp", status, source, wording,
      capturedAt: c.T(ago), capturedBy: null, history: history ?? [{ status, source, at: c.T(ago) }],
    });
  };
  const W_ORDER = "ابعتولي حالة الطلب على واتساب";
  const W_CLUB = "موافق أستقبل رسايل النقط والعروض على واتساب — أقدر ألغي في أي وقت";
  consent("1", "01005551201", "1", "opted_in", "qr_loyalty", 40 * 24 * 60, W_CLUB);
  consent("8", "01005551208", "8", "opted_in", "online_checkout", 34, W_ORDER);
  consent("2", "01005551202", "2", "opted_in", "online_checkout", 9 * 24 * 60, W_ORDER);
  consent("6", "01005551206", "6", "opted_in", "staff", 60 * 24 * 60, "موافقة شفهية في المطعم (سجّلها الكاشير)");
  consent("9", "01005551209", "9", "opted_out", "inbound_keyword", 2 * 24 * 60 - 30, W_CLUB, [
    { status: "opted_in", source: "qr_loyalty", at: c.T(20 * 24 * 60) },
    { status: "opted_out", source: "inbound_keyword", at: c.T(2 * 24 * 60 - 30) },
  ]);
  return { conversations, messages, messagingConsents };
}
