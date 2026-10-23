# Sufra OS: Restaurant Operating System Feature Catalogue (Egypt + KSA)

Version: research draft, 2026-10-23. Each feature is listed once (duplicates were merged) and tagged:
- **[must]**: needed to match Foodics / Odoo / Toast at launch in Egypt and KSA
- **[should]**: expected by mid-size chains; this is where we beat the competition
- **[later]**: differentiators or enterprise features

The wave code (W1/W2/W3) at the end of each line comes from the **Wave plan** at the bottom.
Competitor references appear as (Foodics), (Odoo), (Toast) and so on, with the URLs listed in **Sources**.

---

## 0. Platform, account & roles
- [ ] [must] Multi-tenant org → brands → branches → devices hierarchy (W1)
- [ ] [must] Owner sign-up and onboarding wizard: country (EG/SA), currency, VAT/tax ID, branches, menu import from Excel (W1)
- [ ] [must] Roles and permissions matrix: owner, manager, cashier, waiter, kitchen, driver, accountant, HR, call-centre. Each sensitive action is a separate permission (void, discount, refund, open drawer, reprint) (Foodics "user roles and permission management") (W1)
- [ ] [must] Staff PIN or card login on shared POS devices, with fast user switching and an inactivity auto-lock (W1)
- [ ] [must] Manager override prompt: a manager enters their PIN on the cashier's device and the override is audit-logged (W1)
- [ ] [must] Full audit log covering who did what, when, on which device, with before/after values (W1)
- [ ] [must] Arabic and English, RTL UI throughout, with bilingual menu item names (W1)
- [ ] [must] Device management: register or revoke POS, KDS, printers and tablets, and see each device's online status (W1)
- [ ] [should] 2FA for owner and admin accounts. Login history (W1)
- [ ] [should] Subscription and billing for Sufra itself, with plans and add-ons per branch (W1)
- [ ] [later] Public API, webhooks and a marketplace for third-party apps (Foodics has a marketplace of 100+ apps) (W3)
- [ ] [later] Data residency option for KSA, hosting data in-Kingdom (Zoho stresses Saudi data centres) (W3)

## 1. POS / cashier
**Order types**
- [ ] [must] Dine-in, takeaway, pickup (pre-order), delivery (own fleet), aggregator, and drive-thru, each with its own price list and tax/service-charge rules (W1. Delivery and aggregator are W2)
- [ ] [must] Order sources tagged as POS, waiter app, QR, kiosk, web, call-centre or aggregator, for reporting (W1)
- [ ] [should] Drive-thru mode: car number or colour, lane timer, pre-pay at window (W2)
- [ ] [should] Call-centre mode: caller-ID lookup, customer address book, route the order to the nearest branch by zone (Sapaad has a delivery call centre with cloud telephony) (W2)
- [ ] [later] Self-order kiosk (Foodics, Odoo) (W3)

**Menu & items**
- [ ] [must] Categories, items, sizes and variants, item images, bilingual names and descriptions, calories (calorie display is mandatory in KSA under SFDA) (W1)
- [ ] [must] Modifier groups: min/max selections, required or optional, priced or free, nested modifiers, plus "no / extra / light / on side" options (W1)
- [ ] [must] Combos and meals with choice slots, upsizing and price deltas (W1)
- [ ] [must] Price per branch, per order type and per time (happy hour) (W1)
- [ ] [must] Open-price item and open item with a free-text name, both permission-controlled (W1)
- [ ] [must] Item and line notes (allergens, "no onion") (W1)
- [ ] [should] Allergen tags and dietary icons (W1)
- [ ] [should] Weighted items (by kg) using a scale (W3)
- [ ] [should] Menu scheduling: breakfast menu, Ramadan iftar/suhoor menu, day-parts (W2)

**Order flow**
- [ ] [must] Seat numbers and guest count (covers) (W1)
- [ ] [must] Courses (starters, mains, dessert) with **hold & fire**: send course 1 now, fire course 2 on demand (Foodics coursing, Toast course firing) (W1)
- [ ] [must] Send to kitchen: incremental tickets and a "re-send" with a reason (W1)
- [ ] [must] Order hold/park and recall (W1)
- [ ] [must] Repeat last item. Quick qty keypad. Item search and barcode (W1)

**Bills**
- [ ] [must] Split bill **by item**, **by seat**, **evenly (N ways)** and **by amount** (Odoo splits by items or groups. Foodics and Toast split by guest) (W1)
- [ ] [must] Merge bills or tables. Transfer items between tables. Transfer a table to another waiter (W1)
- [ ] [must] Pre-bill (check) print without closing the order (W1)
- [ ] [must] Service charge, configurable per order type and branch (common in KSA and Egypt: 12% service in Egypt) (W1)
- [ ] [must] Discounts on an item or the order, as % or a fixed amount, with reason codes, limits per role and manager approval above a threshold (W1)
- [ ] [must] Void before sending to kitchen (no approval) vs after sending (approval plus reason, prints a void ticket to kitchen) (W1)
- [ ] [must] Refund, full or partial, linked to the original invoice, issuing a credit note and returning stock (credit notes are required for ETA and ZATCA) (W1)
- [ ] [must] Comp/complimentary (on-the-house) items with a reason (W1)
- [ ] [must] Tips: added on card, cash tip declaration, tip pooling and distribution rules (W1. Pooling in W3 HR)

**Payments**
- [ ] [must] Multiple tenders per bill: cash, card (integrated or manual), wallet, gift card, loyalty points, house account (on credit), voucher (W1. Integrated card in W2)
- [ ] [must] Change calculation. Quick-cash buttons. Multi-currency cash optional (W1)
- [ ] [must] Customer/AR account ("آجل") for corporate customers, with credit limit and statement (W1)
- [ ] [should] Card terminal integration (Geidea, Paymob, Nearpay, mada terminals) and SoftPOS / Tap-to-Pay (W2)

**Cash & shifts**
- [ ] [must] Cash drawer kick via the printer, with permission and a log of "no-sale" opens (W1)
- [ ] [must] Shift (till) open with opening float. Cash in/out (paid-in/paid-out) with reason. Blind close (count before seeing expected). Over/short (W1)
- [ ] [must] **X report** (mid-shift, non-resetting) and **Z report** (end of day, resetting, sequential number) per device and branch, broken down by tender, order type, category, tax, discounts, voids, refunds and tips (W1)
- [ ] [must] Business-day close, separate from the calendar day, since restaurants open past midnight (W1)

**Resilience & hardware**
- [ ] [must] **Offline mode**: the POS keeps selling, printing and KDS-routing on the LAN. Queued sync. Offline-safe invoice numbering per device. The ETA/ZATCA submission queue retries later (W1)
- [ ] [must] Printer routing: kitchen and bar printers by category or item, with multiple copies. Receipt printer per station. ESC/POS over LAN/USB/BT. Arabic printing using raster mode (Odoo routes by product category) (W1)
- [ ] [must] Failover: if a kitchen printer is down, reroute to a backup and alert (W1)
- [ ] [should] Customer-facing display showing the order, total, a QR to pay or join loyalty, and promos (Foodics CDS) (W1)
- [ ] [should] POS hardware support: Sunmi / iMin Android all-in-ones, iPad, Windows. Barcode scanner. Scale (W1)
- [ ] [later] Smart caller-ID box support for the call-centre (W2)

## 2. Floor & reservations
- [ ] [must] Floor plan editor: multiple floors and areas (indoor, terrace, VIP, family section), table shapes, seat counts, drag and drop, walls and decor (W1)
- [ ] [must] Table states with colours: free (green), reserved (blue), seated/ordered (yellow), food served, bill requested (orange), paid/needs cleaning (grey/red), blocked (W1)
- [ ] [must] Table timer since seated, plus an "idle since last order" timer (W1)
- [ ] [must] Merge and unmerge tables (join for big parties) and split a table into sub-tables (W1)
- [ ] [must] Waiter assignment by section (W1)
- [ ] [should] Turn-time analytics: average turn by table size, daypart and section. Covers per hour. Revenue per seat-hour (Toast uses average turn time in its wait estimator) (W2)
- [ ] [should] Live host view: which tables have ordered, been fired, served or paid (Toast Tables) (W2)
- [ ] [must] Reservations book: date/time slots, party size, table assignment, notes and tags (birthday, VIP), and a timeline (Gantt) view (W2)
- [ ] [must] **Online booking from home**: branded booking page and widget, plus an Instagram/Google link, showing slot availability and pacing (max covers per 15 minutes) (W2)
- [ ] [must] Confirmations and reminders via WhatsApp/SMS. One-tap confirm or cancel (Toast sends SMS reminders to reduce no-shows) (W2)
- [ ] [should] **Deposits / prepayment** for peak slots or large parties, via pay-by-link. Cancellation policy. Deposit credited to the bill (Eat App deposits) (W2)
- [ ] [should] **No-show handling**: mark as no-show, track a customer no-show score, require a deposit for repeat offenders, forfeit deposit per policy (W2)
- [ ] [must] **Waitlist**: quoted wait time, WhatsApp "your table is ready" message, and online join-the-waitlist by QR or link (Toast online waitlist with Manual Multiplier vs Smart estimator) (W2)
- [ ] [later] Google "Reserve with Google" and Eat App / aggregator booking channels (W3)
- [ ] [later] Server rotation, i.e. auto-seat the next waiter in rotation (Toast) (W3)

## 3. Kitchen (KDS)
- [ ] [must] KDS screens per station (grill, fryer, cold, bar, dessert) with routing by item/category and order type (Odoo preparation display for multiple kitchen and bar screens) (W1)
- [ ] [must] Ticket shows order number, table, waiter, order type, seat, course, modifiers highlighted, notes, allergens (W1)
- [ ] [must] **Bump**, per item or whole ticket, and **recall** of the last bumped tickets (W1)
- [ ] [must] **Ticket aging** colours: green, then yellow after X minutes, then red after Y minutes, with an audible alert (W1)
- [ ] [must] Course awareness: held courses are greyed out until fired. Rush/VIP flag (W1)
- [ ] [must] **Expo / pass screen**: aggregates all stations for an order and is bumped when the whole order is ready. A "ready" notification goes to the waiter app or pickup screen (Lightspeed sends FOH alerts when an order is ready) (W1)
- [ ] [must] **86 items**: mark an item out of stock from the KDS or POS. It disappears instantly from the POS, QR menu, web ordering and aggregators. Optional countdown quantity (W1. Aggregator sync in W2)
- [ ] [must] Void and modify tickets shown clearly ("CANCELLED", changed lines) (W1)
- [ ] [should] Prep times per item, so the expected-ready time staggers start ("start fries 4 minutes after burger") (W2)
- [ ] [should] All-day / consolidated view: totals of each item pending across tickets (W1)
- [ ] [should] Kitchen performance report: average ticket time by station, item and hour, plus late tickets (W2)
- [ ] [should] Customer order-status board (pickup screen: "preparing / ready" numbers) (W1)
- [ ] [should] KDS works on cheap Android TV or tablets. Bump bar support (W1)
- [ ] [later] Recipe card or video on the KDS item tap (W3)

## 4. Waiter & guest (in-venue)
- [ ] [must] Waiter app on phone or tablet: floor view, take order with modifiers and seats, send, fire course, print or present the bill, take payment (W1)
- [ ] [must] **QR table ordering**: a unique QR per table opens the menu (bilingual, photos), and the guest orders. Configurable flow: auto-send to kitchen or waiter-approve first. Pay now or later (Foodics Local, Odoo QR menu + ordering) (W1)
- [ ] [must] QR menu-only mode (view only) (W1)
- [ ] [must] **Call-waiter requests** from QR: buttons for *call waiter, water, napkins, cutlery, bill please, clean table, help/complaint* plus free text. They go as a push notification and sound to the section waiter's app, show a table badge on the floor plan, and escalate to the manager if not acknowledged within N seconds. Response-time KPI. *Neither Foodics nor Odoo highlights call-waiter features, so this is a differentiator.* (W1)
- [ ] [must] **Pay at table**: scan the QR, see the live bill, pay full or **split** (by items, equal share, custom amount), add a tip, and get an e-receipt by WhatsApp/email (Foodics Pay at Table) (W2, since online payments are needed)
- [ ] [must] **Post-visit feedback**: after payment, show star ratings for food, service, cleanliness and speed, plus a comment. Low scores alert the manager instantly. High scores are prompted to leave a Google review (W1 basic, W2 via WhatsApp)
- [ ] [should] Guest identification on QR (phone + OTP) to link loyalty, saved preferences and order history (W2)
- [ ] [should] Group ordering: several phones at one table add to a shared cart (W2)
- [ ] [should] Upsell prompts in the QR menu and waiter app ("add a drink?") (W2)
- [ ] [later] Handheld card payment on the waiter device (SoftPOS) (W2)

## 5. Online ordering & delivery
- [ ] [must] Own branded ordering web app (PWA) and optional white-label mobile app: menu, cart, modifiers, scheduled orders, pickup or delivery, Arabic/English (Foodics Online) (W2)
- [ ] [must] Delivery zones drawn on a map as polygons or radius, each with a fee, minimum order, ETA and the branch serving it. Auto-route to the nearest branch (Sapaad delivery area maps) (W2)
- [ ] [must] Address capture: map pin plus building, floor and apartment. Saved addresses. Egypt landmarks. KSA national address (W2)
- [ ] [must] Order acceptance screen at the branch, with a sound and auto/manual accept, plus prep-time selection (W2)
- [ ] [must] Order status pipeline: **received → accepted → preparing → ready → picked up / out for delivery → delivered** (and cancelled/rejected with reason) (W2)
- [ ] [must] **Driver app**: login, availability, order list, accept, navigation (Google Maps/Waze deep link), call customer, collect cash (COD), proof of delivery (photo or OTP), cash-in-hand balance (W2)
- [ ] [must] Driver assignment: manual dispatch board plus auto-assign (nearest / least busy / round-robin), and batching of multiple orders (W2)
- [ ] [must] **Live tracking** link for the customer, showing the driver on a map with ETA (W2)
- [ ] [must] Driver cash settlement at end of shift (W2)
- [ ] [should] Third-party fleet integration: Mrsool, Lyve, Bosta (EG), Careem/Quiqup and on-demand courier APIs (W3)
- [ ] [must] **Aggregator integrations** that pull orders into POS and KDS, sync menu and prices, and sync 86 status:
  - KSA: HungerStation, Jahez, Keeta, Mrsool, ToYou, Careem, The Chefz, Shgardi (Foodics connects these through Foodizone and FeedUs)
  - Egypt: Talabat EG, elmenus, Breadfast (grocery), Mrsool EG, Keeta EG
  - Route: direct APIs where available (Talabat Restaurant Integration API needs partner onboarding), otherwise via middleware (Deliverect, Foodizone, Grubtech, UrbanPiper) (W2)
- [ ] [should] Aggregator commission tracking and reconciliation report (expected payout vs received) (W2)
- [ ] [must] **Order status notifications via WhatsApp (SMS fallback)**. Each stage sends this template:
  1. *Order received*: order number, items summary, total, payment method, tracking link
  2. *Accepted / preparing*: "Your order is being prepared, ETA HH:MM"
  3. *Ready for pickup* (for pickup orders), with branch location link
  4. *Out for delivery*: **driver name, driver phone (or masked call button), vehicle/plate, live tracking link**, ETA
  5. *Driver arriving* (optional, about 2 minutes away / at door)
  6. *Delivered*: thank you, e-receipt (PDF/link with ETA/ZATCA QR), **rate your order** link
  7. *Cancelled / delayed*, with reason and refund info
  (W2)
- [ ] [should] Customer-facing order history and re-order (W2)
- [ ] [later] Catering / bulk pre-orders with a deposit (W3)

## 6. WhatsApp (Business Platform / Cloud API)
**What's needed** (owner-side):
- [ ] [must] Meta Business Portfolio (Business Manager), **Meta Business verification** (commercial registration and tax documents, website/domain), WhatsApp Business Account (WABA), a dedicated phone number not active on the WhatsApp app (or migrated), approved display name (W2)
- [ ] [must] Choose a route: **direct Cloud API** (Meta-hosted, which we, as a Tech Provider, onboard via Embedded Signup) or via a **BSP** (W2)
- [ ] [must] Template messages need **Meta approval** (typically minutes, up to 24 hours). Categories are **Marketing / Utility / Authentication**. Promotional wording in a Utility template is reclassified as Marketing. Variables need sample values. Lowercase/underscore names (W2)

**Pricing rules** (current Meta model, per-message since 1 Jul 2025):
- Charged **per delivered template message**, by category and recipient country. User-initiated messages are free.
- **24-hour customer service window (CSW)**: opens or resets whenever the customer messages. Inside it, free-form (non-template) messages are allowed. Outside it, only templates.
- **Free service messages**: 1,000/month per number. From **1 Oct 2026 service messages beyond that, and utility templates sent inside the CSW, become charged** (previously free).
- **Free entry point**: a reply to a Click-to-WhatsApp ad opens a free window of up to 7 days.
- Volume tiers lower utility and authentication rates.
- Egypt: utility and auth rates lowered Oct 2025, marketing lowered Jan 2026. KSA: utility and auth lowered Oct 2025, **marketing raised Apr 2026 and again Oct 2026**. KSA can now be billed in SAR. Get exact rates from the Meta rate-card CSV. A third-party May 2026 card shows Egypt marketing much more expensive than utility (≈18× ratio), so **design order notifications as Utility and keep marketing sparse and segmented**.

**BSP options popular in EG/KSA**: Unifonic (Riyadh, Egypt office, customers include HungerStation and Careem), Taqnyat (KSA), Infobip, Twilio, 360dialog, WATI, respond.io, SleekFlow, YCloud, Vonage, plus Egyptian resellers (e.g. Cequens, Victory Link). Confirm current Meta partner status before signing.

**Templates a restaurant needs** (category in brackets):
- [ ] [must] `otp_login` (Authentication): login/phone verification for ordering and loyalty
- [ ] [must] `order_received`, `order_accepted_eta`, `order_ready_pickup`, `order_out_for_delivery` (driver name/phone/tracking), `order_delivered_receipt`, `order_cancelled`, `order_delayed` (Utility)
- [ ] [must] `payment_link` (pay for order or deposit), `payment_received`, `refund_processed` (Utility)
- [ ] [must] `reservation_confirmed`, `reservation_reminder` (2h before, with confirm/cancel buttons), `reservation_cancelled`, `waitlist_table_ready`, `deposit_request` (Utility)
- [ ] [must] `feedback_request` after visit/delivery (Utility, kept neutral without promo wording)
- [ ] [should] `loyalty_points_update`, `reward_unlocked`, `gift_card_received` (Utility; becomes Marketing if it pushes an offer)
- [ ] [should] `birthday_offer`, `win_back_offer`, `new_menu_launch`, `ramadan_offer`, `campaign_generic` (Marketing, with opt-out)
- [ ] [should] Staff/internal: `shift_reminder`, `payslip_ready`, `low_stock_alert`, `daily_sales_summary_owner` (Utility, to opted-in staff/owner)
- [ ] [should] Shared inbox: agents reply inside the 24h window, with WhatsApp ordering via catalogue / chat-bot (W2)
- [ ] [must] Opt-in capture and opt-out ("STOP") management. Quiet hours. Per-customer frequency cap (W2)

## 7. CRM, loyalty & marketing
- [ ] [must] Customer profile: phone (primary key), name, multiple addresses, birthday, gender, tags, notes/allergies, visits, spend, AOV, last visit, favourite items, channel, no-show count (Foodics CRM) (W2)
- [ ] [must] Customer lookup on POS by phone, with order history (W1 basic)
- [ ] [must] Segments: RFM (champions, at-risk, lost), new vs returning, by branch, by item affinity, birthday this month, spend thresholds (W2)
- [ ] [must] Loyalty **points** (earn per currency unit, burn as a discount or item), expiry, exclusions (Foodics points or punch cards) (W2)
- [ ] [should] **Tiers** (silver/gold/platinum) with multipliers and perks (W2)
- [ ] [must] **Stamp/punch cards**, e.g. "buy 9 coffees, 10th free" (W2)
- [ ] [must] **Coupons / promo codes**: single or multi-use, unique codes, validity, channel, branch, minimum spend, first order only (W2)
- [ ] [must] Automatic promotions: BOGO, buy X get Y, bundle price, % off category, happy hour / timed events, spend-threshold reward (Foodics) (W2)
- [ ] [must] **Gift cards**: physical or e-gift, sell, top-up, balance check, use as a tender, expiry (Foodics) (W2)
- [ ] [should] Digital wallet card (Apple Wallet / Google Wallet loyalty pass) (W2)
- [ ] [must] Campaigns over **WhatsApp / SMS / push / email** to segments: scheduling, A/B tests, attribution (redemptions and revenue) (W2)
- [ ] [must] **Birthday offers** automated N days before (W2)
- [ ] [should] **Referral**: give X, get Y with a unique referral link (W2)
- [ ] [should] Automated journeys: welcome, 2nd-visit nudge, win-back after N days, post-feedback recovery coupon for low ratings (W2)
- [ ] [should] **Lead data capture**: Wi-Fi login, QR menu sign-up, reservation, online order. Consent flags (Egypt PDPL 151/2020, KSA PDPL) (W2)
- [ ] [should] **In-app ads, two kinds**:
  - (a) **Restaurant's own promos** shown to its customers in the QR menu, ordering app, customer display, receipt footer and WhatsApp (W2)
  - (b) **Platform-sold sponsored placements**: Sufra sells banner and featured slots in the consumer-facing directory/app, with self-serve ad buying, budget, CPM/CPC, impressions, clicks and orders reporting (W3/later)
- [ ] [later] Corporate/B2B accounts and meal-plan subscriptions (W3)
- [ ] [later] Customer app with a cross-restaurant directory (needed before platform ads make sense) (W3)

## 8. Inventory & purchasing
- [ ] [must] Ingredients/raw items with units and conversions (kg → g, case → pcs) (W3)
- [ ] [must] Recipes / BOM per item and modifier (extra cheese deducts cheese), sub-recipes / prep items (sauces) (Foodics recipe-based tracking) (W3)
- [ ] [must] Real-time stock deduction on sale, reversed on void or refund (W3)
- [ ] [must] Warehouses: branch store, central warehouse, **central kitchen** with production orders (Foodics, Sapaad, Rista) (W3)
- [ ] [must] Stock counts (full and cycle), a count sheet on mobile, variance report (theoretical vs actual) (W3)
- [ ] [must] Waste / spoilage / staff meal logging with reasons (W3)
- [ ] [must] Transfers between branches and warehouses, with request → approve → dispatch → receive (W3)
- [ ] [must] Suppliers, supplier price lists, purchase orders, goods receiving (GRN) with partial receipt, supplier invoices and returns (W3)
- [ ] [must] Approval workflows for POs and transfers (Foodics) (W3)
- [ ] [must] Costing: weighted average cost, recipe cost, food cost %, theoretical vs actual COGS (W3)
- [ ] [should] Reorder points / par levels with suggested POs (Foodics reorder recommendations) (W3)
- [ ] [should] Batch / expiry tracking for perishables (W3)
- [ ] [should] **Menu engineering**: stars/plowhorses/puzzles/dogs based on margin and popularity (Foodics) (W3)
- [ ] [later] Supplier portal / marketplace ordering (Foodics Supply) (W3)

## 9. HR, attendance & payroll
- [ ] [must] Employee file: national ID / iqama, nationality, contract, salary components, bank IBAN, documents with expiry alerts (iqama, health card) (W3)
- [ ] [must] **Attendance**:
  - Biometric fingerprint/face devices (ZKTeco is most common in EG/KSA) via push SDK or ADMS, or CSV import
  - **Geofenced mobile check-in** with a selfie / face match
  - POS clock-in with PIN (Loyverse, Lightspeed timeclock, ZenHR–Foodics cashier clock-in) (W3)
- [ ] [must] Shifts and scheduling: templates, rota per branch, split shifts, swap requests, publish to the staff app/WhatsApp (W3)
- [ ] [must] Late, early-leave, absence and overtime rules, and auto-calculation (W3)
- [ ] [must] Leave: annual, sick, unpaid and Hajj leave. Balances and accruals per local law. Approval flow (W3)
- [ ] [must] **Advances (سلف)** and loans, with instalment deduction schedule (W3)
- [ ] [must] Payroll run: earnings (basic, housing, transport, OT, tips share, incentives) and deductions (absence, lateness, advances, penalties, social insurance, Egyptian income tax), approval, lock, **payslips** via app/WhatsApp, bank file export (W3)
- [ ] [must] **Egypt**: Social Insurance Law 148/2019. Rates are 11% employee and 18.75% employer on insurable wage. 2026 insurable wage is min EGP 2,700 / max EGP 16,700 per month. Private-sector minimum wage applies (EGP 7,000, per secondary source). Labour Law (new Labour Law No. 14/2025) covers leave and contracts. Salary tax brackets (W3)
- [ ] [must] **KSA**: GOSI. Saudis on legacy rates are ~11.75% employer and 9.75% employee. New entrants since Jul 2024 are on a rising schedule. Non-Saudis pay 2% occupational hazard. Base is basic + housing, capped at SAR 45,000. **Mudad / WPS** salary file through a Saudi bank. Mismatches hurt Nitaqat. End-of-service benefit accrual (½ month per year for the first 5 years, then 1 month). Verify rates on gosi.gov.sa (W3)
- [ ] [should] Sales-per-employee and labour-cost % (Jisr–Foodics integration does this) (W3)
- [ ] [should] Integrations with Jisr, ZenHR, Bayzat, Mudad (as an alternative to native payroll) (W3)
- [ ] [later] Hiring/onboarding, performance reviews, training checklists (W3)

## 10. Accounting & cash
- [ ] [must] Daily sales summary per branch: tender breakdown, deposits, cash variance (W1 reports, W3 accounting)
- [ ] [must] Expenses and **petty cash** per branch, with receipt photo and approval (W3)
- [ ] [must] **Cash flow / liquidity view**: cash in tills, safe, bank and gateway settlements pending, aggregator payouts due, payables due (W3)
- [ ] [must] **Bank reconciliation**: import statements, match card settlements (gateway reports) and deposits (W3)
- [ ] [must] **P&L per branch and brand**: sales, COGS (from inventory), labour (from payroll), rent and opex, giving prime cost (W3)
- [ ] [must] Chart of accounts and auto journal entries from sales, purchases and payroll (W3)
- [ ] [must] Accounts payable (suppliers) and receivable (house accounts) with ageing (W3)
- [ ] [should] Integrations: Qoyod, Wafeq, Daftra (KSA/EG), Zoho Books, Xero, QuickBooks, Odoo, SAP B1 (Foodics has Foodics Accounting plus marketplace connectors) (W3)
- [ ] [should] VAT return report (KSA 15%, Egypt 14%) and withholding (W3)
- [ ] [later] Budgeting and forecasting. Multi-company consolidation (W3)

## 11. Tax & e-invoicing
**Egypt ETA** (existing research; here is what competitors highlight):
- [ ] [must] e-Receipt (B2C): JSON receipt per sale, UUID, signed, per **registered POS device**, QR printed on the receipt, near-real-time submission with an **offline retry queue** (W1)
- [ ] [must] e-Invoice (B2B) for corporate customers/AR, with signing (HSM/USB token or cloud signer) (W1)
- [ ] [must] Return/credit receipts linked to the original. Submission status dashboard (accepted/rejected with error) (W1)

**Saudi ZATCA FATOORA** (technical summary):
- **Phase 1** (since 4 Dec 2021): generate e-invoices electronically. No handwritten invoices. Simplified invoices carry a **QR with TLV tags 1–5**.
- **Phase 2** (integration), rolled out in **waves**: Wave 1 Jan 2023 (> SAR 3bn). **Wave 23** (> SAR 750k turnover in 2022/23/24, deadline 31 Mar 2026). **Wave 24** (> SAR 375k, the VAT registration threshold, deadline **30 Jun 2026**). In practice almost every VAT-registered restaurant is now in scope. Check for later waves.
- **Format**: **XML UBL 2.1** with ZATCA's KSA extensions. Every invoice has a **UUID** (RFC 4122), an **Invoice Counter Value (ICV)** and the **Previous Invoice Hash (PIH)** chain per EGS unit. PDF/A-3 with embedded XML for archiving.
- **Invoice types**: **Standard tax invoice (B2B/B2G)** must be **cleared** in real time via the Clearance API before it is given to the buyer. **Simplified tax invoice (B2C, i.e. restaurant receipts)** is **reported** via the Reporting API **within 24 hours**. Debit/credit notes for each.
- **Cryptographic stamp**: ECDSA secp256k1 signature over the invoice hash (SHA-256), as XAdES within UBL, using the EGS unit's private key and the **CSID** (X.509 certificate issued by ZATCA).
- **QR (Base64 of TLV)**: 1 seller name, 2 VAT number, 3 timestamp, 4 invoice total incl. VAT, 5 VAT total, **6 invoice hash, 7 ECDSA signature, 8 ECDSA public key, 9 ZATCA CA signature of the stamp's public key (simplified only)**.
- **Onboarding (per EGS unit = each POS device or solution unit)**: Fatoora portal → generate OTP (valid ~1 hour, up to 100 per request) → EGS generates a key pair and **CSR** (CN, EGS serial, org identifier = VAT number, invoice types flag, branch, industry) → **Compliance CSID** → submit compliance sample invoices for every type (standard/simplified × invoice/credit/debit) → **Production CSID** → go live. Handle renewal and revocation.
- [ ] [must] EGS unit per POS device: key generation, CSR, CSID storage (secure), ICV/PIH chain kept even offline (W3)
- [ ] [must] UBL 2.1 XML builder, signer, QR TLV generator, Reporting API (simplified, async queue ≤ 24h) and Clearance API (standard B2B, sync) (W3)
- [ ] [must] Phase 1 QR (tags 1–5) on KSA receipts from day 1 as a fallback until Phase 2 is live (W1)
- [ ] [must] Validation using the ZATCA SDK / sandbox (Developer Portal, simulation environment). Error dashboard. Reissue flow (W3)
- [ ] [should] Become a ZATCA-listed solution provider (Zoho and Foodics advertise this) (W3)

## 12. Payments
- [ ] [must] Gateway abstraction layer: create payment, pay-by-link, webhook, refund, settlement report, per-tenant merchant credentials (W2)
- **Egypt**: **Paymob** (cards, wallets such as Vodafone Cash, valU/BNPL, Meeza, payment links, terminals), **Kashier** (invoices/links, iframe sessions), **Fawry** (FawryPay reference codes at about 100k outlets, cards, wallets), **Geidea** (terminals, online), **Accept** (= Paymob's legacy brand). **InstaPay**: there is no general merchant API, so treat it as "manual / IPN reference" or offer it via gateways that support InstaPay request-to-pay as it rolls out. Also Meeza QR. Verify with each provider.
- **KSA**: **Moyasar** (SAMA-licensed, mada, Visa/MC, Apple Pay, STC Pay, developer-friendly), **HyperPay** (mada, Apple Pay, STC Pay, Tabby/Tamara BNPL, SADAD), **Tap** (mada, Apple Pay, STC Pay, BNPL), **Geidea** (terminals, SoftPOS with SAB), **Nearpay** / **EdfaPay** SoftPOS. **Tap to Pay on iPhone in KSA** was announced by SAMA in Sep 2026. BNPL: **Tabby, Tamara**.
- [ ] [must] Apple Pay (domain verification) and mada on the web ordering page and pay-at-table (W2)
- [ ] [must] Pay-by-link (WhatsApp/SMS) for deposits, call-centre orders and catering (W2)
- [ ] [should] Integrated card terminals (ECR protocol, e.g. Geidea/Nearpay) so the amount is pushed from POS, with auto reconciliation (W2)
- [ ] [should] Tokenized saved cards for repeat customers (W2)
- [ ] [should] Settlement reconciliation: gateway payouts vs POS tenders, with fees (W3)

## 13. Operations extras
**CCTV / cameras** (what's realistic):
- [ ] [should] **POS-to-video overlay / exception search**: send transaction events (voids, refunds, discounts, no-sale drawer opens) with timestamp and register ID to the NVR/VMS (Hikvision/Dahua text-overlay "POS" input, Milestone, Eagle Eye, March Networks). Tap an exception in Sufra to open the clip at that timestamp. This is the proven pattern (Envysion × Aloha Restaurant Guard, March Networks) (W3)
- [ ] [should] Embedded live view of branch cameras in the owner app (via RTSP→WebRTC gateway, or vendor cloud P2P SDK) (W3)
- [ ] [later] AI analytics: people counting at the entrance (built into many Hikvision/Dahua cameras, so just ingest the counts), queue length, **table occupancy detection** (achievable with a ceiling camera plus a vision model, but expect tuning per venue, so treat it as a pilot), and cross-check of "table occupied but no open order" for fraud (W3)

**Walkie-talkie / push-to-talk**:
- [ ] [should] In-app PTT channels: kitchen ↔ floor, manager, drivers. Options: **Zello** (Channels SDK over WebSocket, mobile SDK for iOS/Android/RN, management API, priced per Zello Work), or build with **WebRTC** (LiveKit / Agora / Twilio Voice) as push-to-talk rooms with Opus audio, plus background audio on mobile. Hardware PoC radios (Hytera/Motorola PoC) as an option (W3)
- [ ] [should] Quick canned voice/text alerts: "table 5 needs you", "order 123 ready" (ties into call-waiter) (W1 as text/push, W3 voice)

**Support hotline / helpdesk**:
- [ ] [must] In-app support chat, ticketing, WhatsApp support line, phone hotline with IVR (cloud telephony), knowledge base in Arabic, remote device diagnostics (W3. Basic WhatsApp support from W1)
- [ ] [should] Status page and incident notices (W3)

**Multi-branch, franchise & owner**:
- [ ] [must] Central menu with branch overrides (price, availability). Push menu to all channels (W1)
- [ ] [must] Multi-branch dashboards and comparison (W1)
- [ ] [should] Franchise mode: royalty % report, franchisee-owned data separation, central purchasing (W3)
- [ ] [must] **Owner mobile app**: live sales, open orders, covers, top items, cash position, staff on shift, approvals (discount/void/PO/leave), alerts (W1 basic, grows each wave)
- [ ] [must] **Alerts**: high void/discount rate, cash variance, KDS late tickets, printer offline, device offline, low stock, bad review, ETA/ZATCA rejection, driver delay (W1 core alerts)
- [ ] [should] Scheduled reports via email/WhatsApp (daily close summary) (W1)
- [ ] [later] Task checklists (opening/closing, cleaning, temperature logs for HACCP) (W3)

## 14. Floor plan from architectural drawing
- **State of the market**: **Eat App's Floor Plan Importer** accepts PNG/JPG/PDF and *automatically detects tables, shapes and seat capacities*, followed by a manual review (one room per file). General tools (ArcSite AI Trace, FloorAI, Maket) detect walls, doors and rooms, **not tables**. Home Designer-style tools use a **trace-over** workflow.
- [ ] [must] **Trace-over editor**: upload an image or PDF (or DXF → raster) as a locked background, scale with two points and a known distance, drop table shapes on top, set seats, then hide the background (W1)
- [ ] [should] **AI-assist detection**: send the plan to a vision model (or an object-detection model trained on table/chair symbols) that returns bounding boxes, shapes and estimated seats as *suggestions*. The user accepts or edits. Works well for clean CAD exports and poorly for hand sketches (W2/W3)
- [ ] [later] Native DWG/DXF import (parse block names such as "TABLE_4" to auto-place) (W3)

## 15. Invoice / receipt designer
- [ ] [must] Template editor: logo (monochrome dithering for thermal), header lines (brand name, branch address, CR no., VAT/tax registration no.), footer lines (Wi-Fi, social handles, return policy, "thank you"), custom fields (W1)
- [ ] [must] Toggle fields: order no., table, waiter, cashier, covers, order type, customer name/phone/address, item modifiers, per-line tax, discounts, service charge, tips, payments and change, loyalty points earned/balance (W1)
- [ ] [must] Mandatory compliance blocks per country: Egypt ETA receipt UUID + QR. KSA "Simplified Tax Invoice / فاتورة ضريبية مبسطة", seller VAT no., VAT breakdown, ZATCA QR (W1)
- [ ] [must] Languages: Arabic, English, or bilingual side-by-side or stacked. Hijri + Gregorian date option for KSA (W1)
- [ ] [must] Paper sizes **58 mm, 80 mm** thermal (raster for Arabic shaping) and **A4/A5** PDF (B2B tax invoice, emailed) (W1)
- [ ] [must] Separate templates for: customer receipt, pre-bill, kitchen ticket, void ticket, X/Z report, delivery label (with address + QR), refund/credit note (W1)
- [ ] [should] Promo/QR blocks on the receipt: feedback QR, loyalty join QR, next-visit coupon (W2)
- [ ] [should] Digital receipt via WhatsApp/email/SMS link (paperless) (W2)
- [ ] [should] Live preview with sample data (W1)

## 16. Reports & analytics (cross-cutting)
- [ ] [must] Sales by hour/day/branch/channel/order type/category/item/employee/table/payment method. Discounts, voids and refunds reports. Tax report (W1)
- [ ] [must] Shift and drawer reports, X/Z history (W1)
- [ ] [should] Customer reports (new vs returning, retention cohorts), loyalty liability (W2)
- [ ] [should] Delivery KPIs (prep time, driver time, late %), aggregator performance (W2)
- [ ] [should] Labour %, food cost %, prime cost, menu engineering (W3)
- [ ] [should] Export to Excel/PDF. Scheduled emails (W1)
- [ ] [later] BI dashboards and AI insights ("why did sales drop Tuesday?"), with demand forecasting for prep and staffing (W3)

---

## Wave plan

**Wave 1: account and roles, POS, floor, kitchen, waiter/service calls, QR menu ordering, invoice with logo + ETA**
- §0 Platform: org/branch hierarchy, onboarding, roles/permissions, PIN login, manager override, audit log, AR/EN RTL, device management, 2FA, Sufra billing
- §1 POS: all dine-in/takeaway/pickup flows, menu, modifiers, combos, price lists, seats, courses hold/fire, split (item/seat/even/amount), merge/transfer, discounts with approval, voids, refunds/credit notes, comps, tips (basic), multi-tender (cash/manual card/gift/house account), cash drawer, shift open/close, X/Z, business day, offline mode, printer routing and failover, customer display, hardware
- §2 Floor: floor editor, table colours/states, timers, merge/split tables, sections
- §3 Kitchen: KDS stations, ticket content, bump/recall, aging colours, courses, expo, 86 (internal), all-day view, pickup status board
- §4 Waiter/guest: waiter app, QR menu (view and order), **call-waiter requests with escalation**, basic in-app feedback
- §11 Egypt ETA e-receipt/e-invoice + KSA Phase 1 QR fallback
- §13: central menu, owner app (basic), core alerts, text/push quick alerts
- §14: trace-over floor-plan editor
- §15: receipt designer (logo, fields, AR/EN, 58/80mm/A4, compliance blocks, all ticket templates)
- §16: core sales, shift and tax reports

**Wave 2: delivery + WhatsApp, reservations from home, online payments, loyalty/offers/ads, CRM**
- §1: drive-thru, call-centre, menu scheduling, integrated card terminals / SoftPOS
- §2: reservations, online booking, reminders, deposits, no-shows, waitlist, turn-time analytics, host view
- §3: prep-time staggering, kitchen performance report
- §4: pay-at-table + split pay online, guest ID/OTP, group ordering, upsell, WhatsApp feedback
- §5: entire online ordering and delivery module, driver app, live tracking, aggregators, WhatsApp status notifications
- §6: entire WhatsApp module (Cloud API/BSP, templates, opt-in, shared inbox)
- §7: CRM, segments, points/tiers/stamps, coupons, promotions, gift cards, wallet passes, campaigns, birthday, referral, journeys, lead capture, restaurant's own promos
- §12: gateway layer, Apple Pay/mada, pay-by-link, saved cards
- §14: AI-assist table detection (beta)
- §15: receipt promo/QR blocks, digital receipts
- §16: customer and delivery reports

**Wave 3: HR/payroll/attendance, accounting/cash, inventory/purchasing, cameras, walkie-talkie, ZATCA, support hotline**
- §8: entire inventory and purchasing module, central kitchen, costing, menu engineering
- §9: entire HR module: attendance devices/geofence/face, scheduling, leave, advances, payroll, EG social insurance, KSA GOSI/Mudad/WPS, EOSB
- §10: entire accounting module: petty cash, cash flow, bank reconciliation, P&L, journals, integrations
- §11: ZATCA Phase 2 (EGS onboarding, UBL/XAdES, reporting/clearance, CSID lifecycle)
- §12: settlement reconciliation
- §13: CCTV overlay/exception video, live view, AI counting pilot, walkie-talkie (Zello/WebRTC), support hotline/helpdesk, franchise mode, checklists
- Later or anytime: kiosk, platform-sold sponsored ads and consumer directory app, public API/marketplace, Google Reserve, DWG import, BI/AI forecasting

> Note on ordering: KSA Phase 2 deadlines (Wave 24) have already passed, so **a KSA customer cannot go live on Sufra without ZATCA Phase 2**. If KSA launch comes before Wave 3, move ZATCA Phase 2 into Wave 1 for KSA tenants, or launch Egypt-first.

---

## What will need the owner's accounts and contracts
1. **Meta / WhatsApp**: Meta Business Portfolio, **business verification** (CR, tax card, website/domain, utility bill), WABA, a dedicated phone number, approved display name, a payment method on the WABA (or a BSP contract, e.g. Unifonic/Taqnyat/Infobip/360dialog), and template approvals.
2. **Payment gateway merchant account(s)**: Egypt (Paymob/Kashier/Fawry/Geidea: CR, tax card, bank account, KYC). KSA (Moyasar/HyperPay/Tap/Geidea: CR, VAT cert, IBAN, SAMA-required KYC). **Apple Pay merchant/domain verification**, and SoftPOS/terminal contracts (Geidea/Nearpay).
3. **ZATCA**: Fatoora portal access (taxpayer login), OTP generation per POS device (EGS), VAT registration certificate. Sufra also needs its own solution listing and compliance testing.
4. **Egypt ETA**: ETA portal taxpayer registration, POS device registration for e-receipt, client ID/secret per POS, signing certificate/e-seal (token or cloud HSM via Egypt Trust / MCDR / Fixed Misr).
5. **SMS sender ID**: Egypt (registered alphanumeric sender via NTRA-approved aggregator, e.g. Cequens/Victory Link/Vodafone). KSA (CST-registered sender ID via Unifonic/Taqnyat/Msegat), which needs CR plus an authorization letter.
6. **Aggregators**: active merchant accounts on Talabat/HungerStation/Jahez/Keeta/elmenus, with integration enablement requested from each aggregator (or a middleware subscription such as Deliverect/Foodizone).
7. **Fingerprint / face devices**: purchase of ZKTeco (or similar) devices with cloud/ADMS support, plus network at each branch.
8. **Cameras / NVR**: existing NVR brand and model, admin credentials, RTSP/ONVIF access, POS text-overlay input or VMS (Milestone/Hikvision HikCentral) licence, and internet uplink for remote view.
9. **Payroll**: KSA (GOSI establishment account, Mudad subscription, WPS-enabled bank). Egypt (social insurance office file number, bank payroll agreement).
10. **Others**: Google Maps Platform API key (billing), Apple/Google developer accounts for white-label apps, domain + email for the ordering site, Zello Work / LiveKit / Agora subscription for PTT, cloud telephony number for call-centre/hotline.

---

## Sources
- Foodics features page: https://www.foodics.com/rms-features/
- Foodics Pay at Table / Local / waiter / KDS: https://www.foodics.com/portfolio/local , https://www.foodics.com/press-media
- Foodics Foodizone (Keeta, Jahez, HungerStation): https://www.foodics.com/portfolio/foodizone/ ; FeedUs: https://foodics.com/portfolio/feedus ; Jahez: https://help.foodics.com/hc/en-us/articles/7530462943132-Jahez ; Deliverect×Foodics: https://deliverect.com/en-ae/integrations/foodics
- Foodics HR integrations: Jisr https://foodics.helpjuice.com/1378457-jisr ; ZenHR https://blog.zenhr.com/en/zenhr-x-foodics
- Odoo 18 restaurant (floor plans, split, preparation display, self-order): https://www.cybrosys.com/odoo/odoo-books/v18/point-of-sale/restaurant-management/ ; https://www.odoo.com/r/qYR
- Toast Tables (waitlist estimators, online waitlist, SMS reminders, host view): https://support.toasttab.com/en/article/Getting-Started-Toast-Waitlist ; https://pos.toasttab.com/au/products/reservations-and-waitlist ; https://pos.toasttab.com/restaurant-pos/casual-dining
- Square KDS coursing limitations: https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Group-by-Course-or-Seat-in-Square-KDS/m-p/295622/highlight/true
- Lightspeed Restaurant: https://www.lightspeedhq.com/pos/restaurant/features/ ; Loyverse review: https://fitsmallbusiness.com/loyverse-review/
- Sapaad: https://www.sapaad.com/ ; Rista: https://www.getapp.com/retail-consumer-services-software/a/rista/
- Talabat integration: https://integration.talabat.com/en/how-it-works/
- WhatsApp pricing (official): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing ; third-party rate card: https://www.salesforce.com/en-us/wp-content/uploads/sites/4/WhatsApp-Business-Messaging-Rate-Card-MM-Lite-May-1-2026.pdf
- WhatsApp templates: https://support.telnyx.com/en/articles/13986483-whatsapp-message-templates-guide ; https://docs.gallabox.com/basic-modules/whatsapp-templates
- BSPs: https://www.ycloud.com/blog/whatsapp-bsp-providers-official-options-2026.md ; https://www.unifonic.com/en/news/unifonic-is-selected-as-whatsapp-business-solution-provider
- ZATCA waves: https://www.ey.com/en_gl/technical/tax-alerts/saudi-arabia-announces-23rd-wave-of-phase-2-e-invoicing-integration ; https://www.wafeq.com/en-sa/tax-and-reporting/zatca-wave-24%3A-who-must-comply-by-june-30-2026-and-exactly-what-you-need-to-do ; https://www.cleartax.com/sa/zatca-wave24-einvoicing-in-saudi-arabia
- ZATCA QR tags: https://zatca1.discourse.group/t/structure-of-the-qr-code-for-electronic-tax-invoices/483 ; https://pub.dev/packages/zatbridge_zatca
- ZATCA onboarding / CSID: https://www.cleartax.com/sa/cryptographic-stamp-identifiers ; https://tallysolutions.com/mena/saudi-vat/step-by-step-e-invoicing-registration-saudi-arabia/ ; https://zatca1.discourse.group/t/getting-started/6027
- ZATCA clearance/reporting, UUID, PDF/A-3: https://ecosire.com/apps/erpnext/erpnext-zatca-pos-einvoicing ; https://www.wafeq.com/en-sa/tax-and-reporting/why-is-the-fatoorah-portal-rejecting-your-invoices-practical-solutions-for-zatca-integration-errors
- Zoho Books ZATCA: https://www.zoho.com/sa/books/e-invoicing
- Egypt e-receipt: https://www.wafeq.com/en-eg/tax-and-reporting/e-receipt-system ; https://ecosire.com/apps/erpnext/erpnext-egypt-eta-ereceipt
- Egypt social insurance 2026: https://www.businesstodayegypt.com/Article/1/6950/Egypt-s-Social-Insurance-Authority-announces-increase-in-wages-starting ; https://eg.andersen.com/social-insurance-in-egypt/ ; https://www.bdo.global/en-gb/insights/tax/expatriate-tax/egypt-maximum-and-minimum-salaries-subject-to-social-insurance-increased
- KSA GOSI/Mudad/WPS: https://www.sovereigngroup.com/saudi-arabia/payroll-services/ ; https://insight.astrolabs.com/business-setup-in-saudi-mastering-gosi-and-mudad-requirements ; https://mercans.com/glossary/gosi-contributions/
- Egypt gateways: https://inai.io/blog/top-payment-methods-in-egypt ; https://packagist.org/packages/dp-soft-co/payments
- KSA gateways / SoftPOS: https://moyasar.com/about ; https://www.creolestudios.com/ksa/?p=7847 ; https://sama.gov.sa/en-US/MediaCenter/News/Pages/news-1170.aspx ; https://www.sab.com/en/about-us/newsroom/news-year-2021/sab-partners-with-saudi-fintech-geidea-to-launch-tap-on-phone
- POS + CCTV: https://totalfood.com/restaurants-integrating-surveillance-pos-drive-thru-systems/ ; https://hospitalitytech.com/envysions-managed-video-service-platform-now-integrates-aloha-restaurant-guard ; https://sdmmag.com/articles/96166-taking-qsrs-to-the-next-level-with-integrated-surveillance-pos-systems
- Push-to-talk: https://sdk.zello.com/ ; https://zello.com/developers/
- Floor plan import: https://restaurant.eatapp.co/knowledge/floor-plan-importer ; https://support.arcsite.com/en/articles/16298763-how-to-trace-a-floor-plan-with-ai-trace
- Eat App deposits / KSA: https://supergood.ai/api-report-card/eat-app ; https://en.wikipedia.org/wiki/Eat_App

**Caveats**: many competitor details come from vendor marketing or third-party listings. Verify the following against primary sources before relying on them: GOSI rates for new entrants, exact WhatsApp rates in EG/KSA (use Meta's rate-card CSV), InstaPay merchant API availability, ZATCA waves after Wave 24, and aggregator API access in Egypt.
