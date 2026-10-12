# سُفرة | Sufra

منصة مطاعم وكافيهات لمصر: موقع الزبائن، نظام المطعم (كاشير، صالة، حجوزات)، والنواة المالية والضريبية.

| Folder | What |
| --- | --- |
| `sufra-web/` | The website (customers, restaurants, suppliers) — Vite + React + TS + Tailwind. Deployed on Vercel. |
| `sufra-floor/` | Floor plan editor, service mode and reservations module (POS). |
| `sufra-finance/` | Finance & tax core: bill pricing (VAT 14%, service 12%), double-entry ledger, Z-report, inventory, ETA e-receipt (SC/RC v1.2). |

Each folder: `npm install`, `npm test`. Website: `cd sufra-web && npm run dev`.
