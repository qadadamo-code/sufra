/**
 * Stock deduction on sale.
 *
 * WHEN: at SEND — the moment a line fires to the kitchen (POS send/fire, waiter app, QR auto-fire or waiter confirm,
 * online-order accept). That is when the food is actually made, so the kitchen's on-hand figure is right during
 * service (a 20:00 count matches the shelf even though the 19:30 tables have not paid yet). Lines that are never
 * sent (a soft drink rung up and paid at the counter) are deducted when the check closes. Both hooks call
 * `deductForItems`, which is idempotent per order line, so a line is never deducted twice whatever the path.
 * `settings.inventory.deductAt = "paid"` switches to paid-only (for venues that don't use the kitchen screens).
 *
 * WHAT: the menu item's recipe × qty (÷ yield), plus each chosen modifier's recipe ("extra cheese" +30 g, "no onion"
 * −20 g), plus — for combos — each component's recipe. Prep items (sauces, doughs) are deducted as their own stock;
 * they were produced earlier with `produce()`. Trim yield and cooking loss are grossed up.
 *
 * WHERE: the stock item's home location in that branch (first of `defaultLocationIds`), else the branch kitchen.
 *
 * VOID after send: the food was made, so the stock stays out — its cost moves from cost of sales to waste
 * (reason "void_after_send"). Before send nothing was deducted, so nothing happens.
 */
import type { Db } from "@/data/hooks";
import type { MenuItem, OrderItem, Recipe, StockItem, StorageLocation } from "@/data/types";
import { uuid } from "@/lib/id";
import { ACC, postJournal, signedLines } from "@/modules/accounting/api";
import { grossQty } from "./costing";
import { addTo, COGS_CODE, postSaleCost, safePost, type ByAccount } from "./posting";
import { inventorySettings } from "./settings";
import { applyMoves, valueByAccount, type MoveInput } from "./stock";
import { q3 } from "./units";

export interface ExplodeContext {
  menuItems: Map<string, MenuItem>;
  stockItems: Map<string, StockItem>;
  /** `${ownerType}:${ownerId}` → recipe */
  recipes: Map<string, Recipe>;
}

export const recipeKey = (t: Recipe["ownerType"], id: string) => `${t}:${id}`;

export function explodeContext(menuItems: MenuItem[], stockItems: StockItem[], recipes: Recipe[]): ExplodeContext {
  return {
    menuItems: new Map(menuItems.map((m) => [m.id, m])),
    stockItems: new Map(stockItems.map((s) => [s.id, s])),
    recipes: new Map(recipes.map((r) => [recipeKey(r.ownerType, r.ownerId), r])),
  };
}

function addRecipe(out: Map<string, number>, r: Recipe | undefined, portions: number, ctx: ExplodeContext) {
  if (!r) return;
  const per = portions / Math.max(1, r.yieldQty || 1);
  for (const l of r.lines) out.set(l.itemId, q3((out.get(l.itemId) ?? 0) + grossQty(l, ctx.stockItems.get(l.itemId)) * per));
}

/** Stock items (base units) one order line consumes. Negative totals (a "no X" on an item without X) are dropped. */
export function explodeLine(line: Pick<OrderItem, "itemId" | "qty" | "modifiers">, ctx: ExplodeContext): Map<string, number> {
  const out = new Map<string, number>();
  const item = ctx.menuItems.get(line.itemId);
  const own = ctx.recipes.get(recipeKey("menu_item", line.itemId));
  if (own) addRecipe(out, own, line.qty, ctx);
  else if (item?.comboOf?.length) for (const c of item.comboOf) addRecipe(out, ctx.recipes.get(recipeKey("menu_item", c.itemId)), line.qty * c.qty, ctx);
  for (const m of line.modifiers) addRecipe(out, ctx.recipes.get(recipeKey("modifier", m.modifierId)), line.qty, ctx);
  for (const [k, v] of out) if (v <= 0) out.delete(k);
  return out;
}

/** Home location of a stock item in a branch. */
export function homeLocation(item: StockItem | undefined, branchId: string, locations: StorageLocation[]): StorageLocation | null {
  const inBranch = locations.filter((l) => l.branchId === branchId && l.active);
  const home = item ? inBranch.find((l) => item.defaultLocationIds.includes(l.id)) : undefined;
  return home ?? inBranch.find((l) => l.kind === "kitchen") ?? inBranch[0] ?? null;
}

type Line = Pick<OrderItem, "id" | "orderId" | "itemId" | "qty" | "modifiers" | "status" | "name">;

/**
 * Deducts the given order lines (skips lines already deducted, voided-before-send and unknown items).
 * Never throws — stock bookkeeping must not block service; failures go to the audit log.
 */
export async function deductForItems(db: Db, lines: Line[], opts: { trigger: "send" | "paid"; branchId?: string | null } = { trigger: "send" }): Promise<number> {
  try {
    // callers may pass the rows as they were before the send (status "new") — only voided lines are skipped
    const live = lines.filter((l) => l.status !== "void");
    if (!live.length) return 0;
    const [settings] = await db.list("settings");
    const s = inventorySettings(settings);
    if (s.deductAt === "paid" && opts.trigger === "send") return 0;
    const done = new Set((await db.list("stockMoves", { where: { refType: "order_item", refId: live.map((l) => l.id) } })).map((m) => m.refId));
    const todo = live.filter((l) => !done.has(l.id));
    if (!todo.length) return 0;
    const [menuItems, stockItems, recipes, locations] = await Promise.all([db.list("menuItems"), db.list("stockItems"), db.list("recipes"), db.list("storageLocations")]);
    const ctx = explodeContext(menuItems, stockItems, recipes);
    const orders = new Map((await db.list("orders", { where: { id: [...new Set(todo.map((l) => l.orderId))] } })).map((o) => [o.id, o]));
    const groupId = uuid();
    const inputs: MoveInput[] = [];
    let branchId: string | null = opts.branchId ?? null;
    for (const l of todo) {
      const order = orders.get(l.orderId);
      const b = order?.branchId ?? opts.branchId ?? db.branchId;
      if (!b) continue;
      branchId = branchId ?? b;
      for (const [itemId, qty] of explodeLine(l, ctx)) {
        const loc = homeLocation(ctx.stockItems.get(itemId), b, locations);
        if (!loc) continue;
        inputs.push({ itemId, locationId: loc.id, branchId: b, kind: "sale", qty: -qty, refType: "order_item", refId: l.id, groupId, note: `#${order?.number ?? ""} ${l.name.ar}`.trim() });
      }
    }
    if (!inputs.length) return 0;
    const moves = await applyMoves(db, inputs, { items: ctx.stockItems });
    await postSaleCost(db, { id: groupId, branchId, cost: valueByAccount(moves, ctx.stockItems), memo: `Cost of sales · ${todo.length} line(s) at ${opts.trigger}` });
    return moves.length;
  } catch (e) {
    await db.audit("stock.deduct.error", "orderItems", lines[0]?.id ?? null, { error: String((e as Error).message ?? e) }).catch(() => undefined);
    return 0;
  }
}

/** A line voided after it was sent: stock stays out (the food was made); its cost is reclassified to waste. */
export async function onLineVoided(db: Db, line: Pick<OrderItem, "id" | "name" | "voidReason">): Promise<void> {
  try {
    const moves = await db.list("stockMoves", { where: { refType: "order_item", refId: line.id, kind: "sale" } });
    if (!moves.length) return;
    const items = new Map((await db.list("stockItems")).map((i) => [i.id, i]));
    const groupId = uuid();
    const back: MoveInput[] = [];
    for (const m of moves) {
      back.push({ itemId: m.itemId, locationId: m.locationId, branchId: m.branchId, kind: "sale_reversal", qty: -m.qty, value: -m.value, refType: "order_item_void", refId: line.id, groupId });
      back.push({ itemId: m.itemId, locationId: m.locationId, branchId: m.branchId, kind: "waste", qty: m.qty, reason: "void_after_send", refType: "order_item_void", refId: line.id, groupId, note: `${line.name.ar} — ${line.voidReason ?? ""}`.trim() });
    }
    const written = await applyMoves(db, back, { items });
    const wasted: ByAccount = {};
    for (const w of written.filter((x) => x.kind === "waste")) addTo(wasted, items.get(w.itemId)?.account ?? "food", -w.value);
    const rows = Object.entries(wasted).filter(([, v]) => v) as [keyof typeof COGS_CODE, number][];
    if (rows.length)
      await safePost(db, "void-waste", () =>
        postJournal(db, {
          branchId: moves[0].branchId, sourceType: "void-waste", sourceId: groupId, memo: `Void after send · ${line.name.en}`,
          lines: signedLines([[ACC.waste, rows.reduce((a, [, v]) => a + v, 0)], ...rows.map(([a, v]) => [COGS_CODE[a], -v] as [string, number])]),
        }),
      );
  } catch (e) {
    await db.audit("stock.void.error", "orderItems", line.id, { error: String((e as Error).message ?? e) }).catch(() => undefined);
  }
}

/**
 * Catch-up sweep: deducts every sent/served line of the last `hours` that has no stock move yet (lines fired on a
 * device that was offline, or before the recipes existed). Idempotent; run from the inventory screen.
 */
export async function catchUpDeductions(db: Db, hours = 24): Promise<number> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const lines = (await db.list("orderItems", { gte: { firedAt: since } })).filter((l) => l.status !== "new" && l.status !== "void");
  return deductForItems(db, lines, { trigger: "send" });
}
