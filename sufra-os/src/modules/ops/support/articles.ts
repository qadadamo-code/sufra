/**
 * In-app help center: short practical articles per module (AR/EN) + search with Arabic normalisation (pure).
 * Written from what the app actually does (README.md). Keep each article to the steps a busy staff member needs.
 */
import type { Localized } from "@/data/types";
import { norm } from "@/lib/arabic";

export interface Article {
  id: string;
  module: string;
  title: Localized;
  body: Localized;
  tags: string[];
  /** where the feature lives */
  path?: string;
}

const A = (id: string, module: string, path: string | undefined, tags: string[], title: [string, string], body: [string, string]): Article => ({
  id, module, path, tags, title: { ar: title[0], en: title[1] }, body: { ar: body[0], en: body[1] },
});

export const ARTICLES: Article[] = [
  A("pin-login", "account", "/login/pin", ["pin", "دخول", "login", "قفل"], ["الدخول بالـ PIN على جهاز مشترك", "Signing in with a PIN on a shared device"], [
    "اختار اسمك من قائمة الموظفين واكتب الـ PIN (٤ أرقام، ينفع عربي أو إنجليزي). الشاشة بتقفل لوحدها بعد مدة الخمول اللي في الإعدادات. علشان تسلّم الجهاز لزميلك: قائمة المستخدم ← اقفل الشاشة. نسيت الـ PIN؟ المدير يغيّره من الموظفين.",
    "Pick your name on the staff list and type your 4-digit PIN (Arabic or Latin digits). The screen locks itself after the idle time set in Settings. To hand the device over: user menu → Lock screen. Forgot your PIN? A manager can reset it under Staff.",
  ]),
  A("pos-order", "pos", "/pos", ["كاشير", "طلب", "order", "pos", "send"], ["طلب جديد في الكاشير", "Taking an order on the POS"], [
    "اختار النوع (صالة/تيك أواي/استلام/دليفري)، دوّس على الصنف علشان يتضاف أو دوسة طويلة للإضافات. N طلب جديد، S بحث، K ابعت للمطبخ. الكورس الأول بيتبعت مع «ابعت»، والباقي بيستنى «اطلق».",
    "Choose the mode (dine-in/takeaway/pickup/delivery), tap an item to add it or long-press for modifiers. N new order, S search, K send to kitchen. Course 1 goes with Send; later courses wait for Fire.",
  ]),
  A("pos-discount", "pos", "/pos", ["خصم", "discount", "موافقة", "approval"], ["الخصومات وموافقة المدير", "Discounts and manager approval"], [
    "D للخصم على الشيك أو من سطر الصنف. نسبة أو مبلغ مع سبب. أي خصم فوق الحد اللي في الإعدادات (افتراضي ١٠٪) محتاج PIN المدير وبيتسجل في السجل وبيظهر كاستثناء في الكاميرات.",
    "D for a bill discount, or from the line sheet. Percent or amount, with a reason. Anything above the limit in Settings (10% by default) needs a manager PIN, is logged, and shows up as a camera exception.",
  ]),
  A("pos-void", "pos", "/pos", ["إلغاء", "void", "مرتجع"], ["إلغاء صنف (Void)", "Voiding an item"], [
    "قبل ما الصنف يتبعت للمطبخ الإلغاء مجاني. بعد الإرسال محتاج PIN المدير وبيطلع تيكت إلغاء للمطبخ. كل إلغاء بيتسجل بالوقت والجهاز والموظف وتقدر تفتح فيديو اللحظة من الكاميرات ← الاستثناءات.",
    "Before an item is sent, removing it is free. After sending it needs a manager PIN and prints a void ticket for the kitchen. Every void is logged with time, device and staff — open the clip from Cameras → Exceptions.",
  ]),
  A("pos-split", "pos", "/pos", ["تقسيم", "split", "دمج", "merge"], ["تقسيم ودمج الشيكات", "Splitting and merging checks"], [
    "X للتقسيم: بالصنف أو بالكرسي (شيكات جديدة) أو بالتساوي أو بمبلغ. الأقساط دايماً بتجمع للإجمالي بالظبط. الدمج والنقل من قائمة الشيك أو من الصالة.",
    "X to split: by item or seat (new checks), evenly, or by amount. Shares always add up exactly. Merge and transfer from the check menu or from the floor.",
  ]),
  A("pos-pay", "pos", "/pos", ["دفع", "pay", "كاش", "فيزا", "إيصال"], ["الدفع والإيصال", "Payments and receipts"], [
    "P للدفع: كاش (فكة سريعة)، فيزا، محفظة، إنستاباي، أو تقسيم الدفع. لما المدفوع يغطي الإجمالي الشيك بيتقفل ويطلع إيصال برقم متسلسل للجهاز والإيصال الإلكتروني للضرايب.",
    "P to pay: cash (quick notes, change), card, wallet, InstaPay or split tender. When tenders cover the total the check closes and a receipt is issued with the device's running number and the ETA e-receipt.",
  ]),
  A("pos-shift", "pos", "/pos/shift", ["وردية", "درج", "shift", "z report", "عجز", "زيادة"], ["فتح وقفل الوردية والدرج", "Opening and closing a shift"], [
    "افتح الوردية بالعهدة. دخول/خروج نقدية بسبب. فتح الدرج من غير بيع محتاج مدير ومتسجل. في الآخر عدّ الفلوس من غير ما تشوف المتوقع ← تقرير Z بالعجز أو الزيادة (بيظهر في مركز التنبيهات).",
    "Open with a float. Paid in/out with a reason. A no-sale drawer open needs a manager and is logged. At the end, blind-count the cash → Z report with over/short (it shows up in the alerts center).",
  ]),
  A("floor", "floor", "/floor", ["صالة", "طاولة", "floor", "table", "حجز"], ["خريطة الصالة وحالة الطاولات", "The floor map and table states"], [
    "الألوان: فاضية، قاعدين، طلبوا، طالبين الحساب، محتاجة تنضيف. دوس على طاولة علشان تقعّد ضيوف أو تفتح الشيك أو تنقل أو تدمج طاولات. تعديل التصميم من زر التصميم (صلاحية المدير).",
    "Colours: free, seated, ordered, bill requested, dirty. Tap a table to seat guests, open the check, move or merge tables. Edit the layout with the Design button (manager).",
  ]),
  A("kitchen", "kitchen", "/kitchen", ["مطبخ", "kds", "تيكت", "86", "خلص"], ["شاشة المطبخ والـ 86", "Kitchen display and 86"], [
    "كل محطة بتشوف أصنافها لايف. دوس علشان «جاهز»، والتيكت بيغيّر لونه مع التأخير. صنف خلص؟ اعمله 86 من شاشة المطبخ — بيختفي من المنيو والـ QR، وبيتسجل كحدث في الكاميرات.",
    "Each station sees its items live. Tap to mark ready; tickets change colour as they age. Out of something? 86 it from the kitchen screen — it disappears from the menu and QR and is logged as a camera event.",
  ]),
  A("waiter-calls", "waiter", "/waiter", ["جرسون", "نداء", "call", "waiter", "QR"], ["نداءات الضيوف من الـ QR", "Guest calls from the QR menu"], [
    "الضيف بيدوس «نادي الجرسون» من الـ QR. النداء بيظهر عندك بصوت. لو محدش ردّ في الوقت المحدد بيتصعّد للمدير وبيظهر في مركز التنبيهات. دوس «رايح» علشان الضيف يعرف إنك جاي.",
    "The guest taps “Call waiter” on the QR menu. The call rings on your phone. If nobody answers in time it escalates to the manager and shows in the alerts center. Tap “On my way” so the guest knows.",
  ]),
  A("qr-menu", "guest", "/settings/qr", ["qr", "منيو", "menu", "ضيف"], ["منيو الـ QR والطلب من الطاولة", "QR menu and ordering at the table"], [
    "كل طاولة ليها كود (ZM01…). اطبع الأكواد من الإعدادات ← QR. الطلبات من الـ QR بتستنى تأكيد الجرسون لو الإعداد مفعّل. الضيف يقدر يطلب الحساب ويدفع أونلاين ويقيّم.",
    "Every table has a code (ZM01…). Print the codes from Settings → QR. QR orders wait for a waiter's confirmation if that's enabled. Guests can request the bill, pay online and leave feedback.",
  ]),
  A("delivery-inbox", "delivery", "/delivery", ["دليفري", "أونلاين", "قبول", "رفض", "delivery"], ["استقبال طلبات الدليفري", "Accepting delivery orders"], [
    "الطلبات الجديدة بتظهر في الوارد بصوت. اقبل بوقت التحضير (بيتبعت للمطبخ والعميل بيعرف الوقت) أو ارفض بسبب. فيه قبول تلقائي لكل قناة ورفض تلقائي بعد مهلة.",
    "New orders ring in the inbox. Accept with a prep time (items fire to the kitchen and the customer gets the ETA) or reject with a reason. Auto-accept per channel and an auto-reject countdown are in Settings.",
  ]),
  A("dispatch", "delivery", "/delivery/dispatch", ["توزيع", "طيار", "خريطة", "dispatch", "متأخر"], ["توزيع الطلبات على الطيارين", "Dispatching to riders"], [
    "اللوحة: بيتحضر ← جاهز ← متوزع ← خرج ← وصل. سُفرة بيقترح الطيار الأنسب وبيجمع الطلبات القريبة. الطلب المتأخر بيحمر وبيظهر في مركز التنبيهات. كلّم الطيارين على قناة الدليفري في اللاسلكي.",
    "Board: preparing → ready → assigned → out → delivered. Sufra suggests the best rider and batches nearby orders. Late orders turn red and appear in the alerts center. Talk to riders on the Delivery radio channel.",
  ]),
  A("rider-app", "delivery", "/driver", ["طيار", "سواق", "rider", "driver", "تسليم"], ["تطبيق الطيار", "The rider app"], [
    "ابدأ الوردية، هتشوف طلباتك. اتصل أو واتساب للعميل، افتح الخريطة، وبعدين: استلمت ← وصلت ← سلّمت (بكود العميل أو صورة). زر اللاسلكي فوق علشان تكلّم الديسباتش وانت سايق — اضغط واتكلم.",
    "Start your shift to see your orders. Call or WhatsApp the customer, open navigation, then: picked up → arrived → delivered (customer code or photo). The radio button at the top talks to dispatch — hold and speak.",
  ]),
  A("rider-cash", "delivery", "/delivery/settle", ["تسوية", "عهدة", "طيار", "cash", "settle"], ["تسوية فلوس الطيار", "Settling rider cash"], [
    "في آخر وردية الطيار: المتوقع مقابل اللي سلّمه. التسوية بتقفل الشيكات وبتسجل العجز/الزيادة في الحسابات وبتظهر في التنبيهات.",
    "At the end of a rider's shift: expected vs handed in. Settling closes the delivered checks, posts any short/over to the ledger, and raises an alert.",
  ]),
  A("whatsapp", "messages", "/messages", ["واتساب", "رسائل", "whatsapp", "قوالب"], ["رسائل الواتساب للعملاء", "WhatsApp messages to customers"], [
    "من غير حساب Meta: «اضغط وابعت» بيفتح واتساب برسالة جاهزة. مع WhatsApp Cloud API الرسايل بتتبعت لوحدها. التسويق محتاج موافقة العميل، و«إلغاء» أو STOP بيوقف الرسايل.",
    "Without a Meta account, click-to-chat opens WhatsApp with the text ready. With the Cloud API, messages go out automatically. Marketing needs opt-in; STOP/إلغاء opts the customer out.",
  ]),
  A("loyalty", "marketing", "/marketing", ["ولاء", "نقاط", "كوبون", "loyalty", "coupon"], ["النقاط والكوبونات", "Points and coupons"], [
    "في الكاشير C ← كوبون / نقاط: اكتب رقم العميل أو امسح كارت الولاء. النقاط بتتحسب لوحدها مع الدفع. العروض والكوبونات من التسويق.",
    "On the POS, C → coupon / points: type the customer's phone or scan their loyalty QR. Points are earned automatically on payment. Offers and coupons live under Marketing.",
  ]),
  A("eta", "pos", "/pos/eta", ["ضرايب", "eta", "إيصال إلكتروني", "مصلحة"], ["الإيصال الإلكتروني (مصلحة الضرايب)", "ETA e-receipts"], [
    "كل إيصال بيتعمل له UUID وQR ومتسلسل مع اللي قبله. طابور ETA بيوضح المعلّق والمرفوض. الإرسال الفعلي محتاج بيانات POS من المصلحة على السيرفر — كلّم دعم سُفرة لتفعيله.",
    "Each receipt gets a UUID, a QR and is chained to the previous one. The ETA queue shows pending and rejected ones. Actual submission needs your POS credentials on the server — ask Sufra support to enable it.",
  ]),
  A("cameras-wall", "cameras", "/cameras", ["كاميرات", "cctv", "بث", "nvr", "camera"], ["مشاهدة الكاميرات", "Watching the cameras"], [
    "الكاميرات ← العرض المباشر: ١ أو ٤ أو ٩ أو ١٦ شاشة، ودوسة مزدوجة لملء الشاشة. المتصفح ما بيشغّلش RTSP مباشرة — محتاج رابط HLS/WebRTC من الـ NVR Cloud أو جهاز صغير في المطعم (go2rtc). من غير ده الكاميرا بتظهر «غير متاحة في المتصفح».",
    "Cameras → Live wall: 1, 4, 9 or 16 tiles; double-tap for fullscreen. Browsers can't play RTSP directly — you need an HLS/WebRTC link from the NVR cloud or a small on-site gateway (go2rtc). Without one the tile says “not playable in a browser”.",
  ]),
  A("cameras-exceptions", "cameras", "/cameras/events", ["استثناءات", "فيديو", "إلغاء", "مرتجع", "درج"], ["ربط الكاشير بالفيديو (الاستثناءات)", "POS ↔ video exceptions"], [
    "كل إلغاء ومرتجع وخصم فوق الحد وفتح درج من غير بيع وعجز/زيادة في الدرج و86 يدوي بيظهر هنا بالوقت والجهاز والموظف والكاميرا اللي بتشوف الجهاز. «افتح الكليب» بيفتح تسجيل الـ NVR في الوقت ده. اربط كل كاميرا بأجهزتها من الإعداد.",
    "Every void, refund, discount above the limit, no-sale drawer open, cash over/short and manual 86 lands here with time, device, staff and the camera that sees that device. “Open clip” jumps to the NVR recording at that moment. Link each camera to its devices in Setup.",
  ]),
  A("occupancy", "cameras", "/cameras/occupancy", ["إشغال", "عدد", "زحمة", "occupancy", "people"], ["الإشغال التقديري (تجريبي)", "Estimated occupancy (beta)"], [
    "المضيف يكتب عدد الناس في كل منطقة، أو كاميرا عدّاد المدخل بتبعت الداخل والخارج. الرقم «تقديري» — مش بديل عن حالة الطاولات.",
    "The host types the head count per zone, or an entrance counter camera sends people in/out. The number is an estimate — not a replacement for table status.",
  ]),
  A("radio", "radio", "/radio", ["لاسلكي", "واكي", "توكي", "ptt", "radio", "صوت"], ["الواكي توكي (اضغط واتكلم)", "Walkie-talkie (push-to-talk)"], [
    "اختار القناة (الكل، الصالة، المطبخ، الدليفري، الإدارة أو شخص) واضغط مطوّل على الزرار واتكلم، سيب علشان تبعت. أقل من نص ثانية بيتلغي، وأقصى مدة ٣٠ ثانية. أول لمسة على الشاشة بتسمح بتشغيل الصوت تلقائي. فيه رسايل جاهزة زي «طاولة ٥ محتاجة جرسون».",
    "Pick a channel (Everyone, Floor, Kitchen, Delivery, Managers or a person), hold the button and talk, release to send. Under half a second is discarded; max 30 seconds. Your first tap on the screen allows auto-play. Quick messages like “Table 5 needs a waiter” are one tap.",
  ]),
  A("tickets", "support", "/support", ["شكوى", "تذكرة", "ticket", "complaint", "عميل"], ["شكاوى الضيوف والتذاكر", "Guest complaints and tickets"], [
    "الضيف يقدر يشتكي من صفحة المطعم أو الـ QR. الشكوى بتبقى تذكرة فيها طلباته وزياراته ومدفوعاته. حدد الأولوية والمسؤول، واكتب ملاحظات داخلية، واقفل بالحل ورسالة متابعة. التذكرة اللي عدّت الـ SLA بتتصعّد.",
    "Guests can complain from the restaurant page or the QR menu. Each complaint becomes a ticket with their orders, visits and payments. Set priority and assignee, add internal notes, then resolve with a follow-up message. Tickets past SLA escalate.",
  ]),
  A("sufra-support", "support", "/help", ["دعم", "مشكلة", "support", "bug", "مساعدة"], ["اطلب دعم سُفرة", "Requesting Sufra support"], [
    "من المساعدة ← اطلب دعم: اوصف المشكلة. التذكرة بتتبعت مع بيانات الجهاز (نسخة التطبيق، المتصفح، حالة المزامنة، آخر الأخطاء) علشان فريق سُفرة يحلها أسرع. تقدر تتابع ردّنا من نفس الصفحة، وحالة الخدمة من «حالة النظام».",
    "Help → Request support: describe the problem. The ticket is sent with diagnostics (app version, browser, sync status, last errors) so the Sufra team can fix it faster. Follow our reply on the same page; service health is under “System status”.",
  ]),
  A("offline", "account", undefined, ["أوفلاين", "نت", "مزامنة", "offline", "sync"], ["لما النت يقطع", "When the internet drops"], [
    "سُفرة بيكمّل يشتغل: الطلبات بتتحفظ على الجهاز وبتتبعت بالترتيب أول ما النت يرجع. أيقونة المزامنة فوق بتوضح عدد العمليات المستنية. ما تقفلش المتصفح لحد ما العدد يبقى صفر.",
    "Sufra keeps working: writes are kept on the device and replayed in order when the connection returns. The sync icon at the top shows how many are waiting. Don't close the browser until it reads zero.",
  ]),
  A("alerts", "alerts", "/alerts", ["تنبيهات", "alerts", "إنذار", "مخزون"], ["مركز التنبيهات", "The alerts center"], [
    "كل اللي محتاج مدير في مكان واحد: نداءات متصعّدة، دليفري متأخر، مخزون قليل، عجز/زيادة في الدرج، استثناءات الكاميرات، مدفوعات فشلت، وتذاكر عدّت الـ SLA. من القواعد حدد مين يتبلّغ بإيه.",
    "Everything that needs a manager in one place: escalated calls, late deliveries, low stock, cash over/short, camera exceptions, failed payments and tickets past SLA. Under Rules choose who is notified of what.",
  ]),
  A("branches", "account", undefined, ["فرع", "فروع", "branch", "تبديل"], ["التبديل بين الفروع", "Switching branches"], [
    "من أعلى الشاشة اختار الفرع. كل الشاشات (الصالة، الكاشير، الكاميرات، التنبيهات) بتتغير للفرع ده. الموظف بيشوف بس الفروع المسموحله بيها.",
    "Pick the branch at the top of the screen. Every screen (floor, POS, cameras, alerts) switches to it. Staff only see the branches they're allowed.",
  ]),
];

/** Search: normalised AR/EN, title hits weigh more than tags, tags more than body. */
export function searchArticles(query: string, list: Article[] = ARTICLES): Article[] {
  const q = norm(query);
  if (!q) return list;
  const words = q.split(" ").filter(Boolean).map((w) => w.replace(/^(?:ال|وال|بال)(?=..)/, ""));
  const scored: { a: Article; s: number }[] = [];
  for (const a of list) {
    const title = norm(`${a.title.ar} ${a.title.en}`);
    const tags = norm(a.tags.join(" "));
    const body = norm(`${a.body.ar} ${a.body.en}`);
    let s = 0;
    let all = true;
    for (const w of words) {
      const t = title.includes(w) ? 5 : 0;
      const g = tags.includes(w) ? 3 : 0;
      const b = body.includes(w) ? 1 : 0;
      if (!t && !g && !b) all = false;
      s += t + g + b;
    }
    if (all && s) scored.push({ a, s });
  }
  return scored.sort((x, y) => y.s - x.s).map((x) => x.a);
}
