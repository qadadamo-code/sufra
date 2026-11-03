# Accounting integrations — design (not built)

Sufra OS keeps the books itself (`ledgerEntries`, double entry, append-only). Many restaurants also have an
external accountant on Odoo, QuickBooks Online, Zoho Books, Daftra, Qoyod or Wafeq. This note says how the
journal leaves Sufra. **Today:** a CSV export (Accounting ▸ Export) in a generic format and in each package's
import layout. **Later:** a push connector.

## 1. What is exported

One row per journal line (`src/modules/accounting/integrations.ts → journalExport`):

| column | meaning |
| --- | --- |
| `entry_no` / `entry_id` | `JE-xxxxxx` (stable, from the uuid) / the uuid — use it as the external id so re-imports don't duplicate |
| `date` | business day (05:00 cut-off) |
| `source_type` / `source_id` | `receipt`, `z-summary`, `payroll`, `purchase-invoice`, `expense`, `cash-transfer`, `payout`, `vat-return`, `manual`, `reversal` … and its document id |
| `account_code` + names | Sufra chart code (Egyptian numbering 1–6) |
| `debit` / `credit` | EGP with 2 decimals (internal precision is 0.00001; lines already round to piastres) |
| `branch`, `drawer`, `supplier` | analysis dimensions (cost centre = branch) |

Rules: entries are **never edited**; corrections arrive as a `reversal` entry plus a new entry, so an import is
append-only on the other side too. Only closed periods should be exported for the accountant's final books
(`accountingSettings.closedThrough`).

## 2. Granularity

Per-receipt entries are noisy in an external GL. Recommended: export **daily summaries per branch** (sum lines of
`receipt`/`return-receipt` by account per business day — exactly what the seed's `z-summary` entries look like)
and every other entry as is. The export screen offers "summarise sales by day".

## 3. Account mapping

The owner's accountant maps each Sufra code to an account in the target once (`ACCOUNT_MAP` holds suggestions).
Stored later as `gl_accounts.note` → `{ "odoo": "...", "qbo": "...", "zoho": "..." }` (no schema change needed now).

| Package | Import path | Notes |
| --- | --- | --- |
| **Odoo 17/18** | Accounting ▸ Journal Entries ▸ Import (`account.move` with `line_ids/…`) | `id` = `sufra_<uuid>` (external id → idempotent). Branch → `analytic_distribution` (one analytic account per branch). Push later via XML-RPC `account.move.create` + `action_post`. |
| **QuickBooks Online** | Settings ▸ Import data ▸ Journal entries (CSV) | Rows grouped by `JournalNo`; date `dd/mm/yyyy`; branch → Location, source → Class. API later: `POST /v3/company/{realm}/journalentry` (OAuth2, per-company). |
| **Zoho Books** | Accountant ▸ Manual Journals ▸ Import | Branch → reporting tag. API later: `POST /books/v3/journals` (OAuth, data-centre aware: `.com` / `.eu` / `.sa`). |
| Daftra / Qoyod / Wafeq | generic CSV | KSA/EG local packages accept a line-per-row journal import; map columns at import time. |

## 4. Push connector (later)

Server function `api/acct-sync.ts` (Vercel cron, nightly): select entries with `date <= closed_through` not yet in
`acct_sync_log (entry_id, target, external_id, status, error)`, group by target, push, record the external id.
Tokens per restaurant in Supabase Vault (never in the browser). Failures stay `error` and show on Accounting ▸
Export with a retry button. Reversals push as new journals referencing the original external id.

## 5. Tax

VAT figures leave as plain journal lines (2201 output, 1401 input, 2301 settlement). The VAT return itself is filed
on the ETA portal; the export never claims to file anything. Every tax figure in Sufra is marked
“تقديري — يراجعه المحاسب”.
