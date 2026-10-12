# Sufra: Egyptian Tax Authority (ETA) compliance spec
## E-Receipt (B2C POS) and E-Invoice (B2B)

Status: research draft, compiled 2026-10-12. Not legal advice. Have an Egyptian tax accountant review section 3 before go-live.

### How to read this document

- Every fact carries a source tag such as **[S5]**. The tags resolve to URLs in [Sources](#sources) at the end.
- **UNCONFIRMED** means one of three things: a primary source could not be found, the primary sources contradict each other, or the value came only from secondary sources (news sites or vendors).
- Field names are case-sensitive and spelled exactly as in the ETA SDK. Some SDK spellings look wrong but are correct for the API, for example `orderdeliveryMode`, `governate` and `sOrderNameCode`.
- The ETA SDK site is `https://sdk.invoicing.eta.gov.eg`. Its preprod mirror is `https://sdk.preprod.invoicing.eta.gov.eg`. A single SDK covers both e-invoicing and e-receipts [S11].

---

## 0. TL;DR for engineers

1. **Document type to use.** Restaurants and cafes have their own receipt types:
   - "Coffee & Restaurant Receipt v1.2": `receiptType` = **`SC`**, `typeVersion` = **`"1.2"`** [S1].
   - "Coffee & Restaurant Return Receipt v1.2": `receiptType` = **`RC`** [S2].
   - Versions 1.0 and 1.1 are retired [S4].
   - The generic receipt uses `s` (sale) and the generic return uses `r`; these are not the restaurant types [S3][S10].
2. **Authentication.** Each POS calls `POST {id-host}/connect/token` with OAuth2 `client_credentials`.
   - Send the headers `posserial`, `pososversion`, `posmodelframework` and `presharedkey` [S8].
   - The token lives 3600 s. Cache it and do not request a new one per call [S8][S15].
3. **Submission.** Submit with `POST {api-host}/api/v1/receiptsubmissions` and body `{"receipts":[...], "signatures":[...]}` [S9][S13].
   - A batch holds 1–500 receipts and at most 1.5 MB [S5][S30].
   - A receipt holds at most 300 lines [S5][S30].
   - Every receipt in a batch must come from the same POS [S5].
4. **UUID and chaining.**
   - `uuid` = lowercase-or-uppercase hex SHA-256 of the ETA "serialized" receipt, computed with `uuid` set to empty (hex case UNCONFIRMED, see §1.5) [S5][S6].
   - `previousUUID` = the `uuid` of the previous receipt from the same POS. It is an empty string only for the POS's very first receipt [S1][S5].
5. **Submission deadlines.**
   - Submit within **24 h** of issuance (UTC) [S5][S30]. Offline issuance is allowed, but the receipts must be uploaded within that window [S30].
   - If the 24 h window is missed, raise a *late submission request* on the portal. It allows receipts up to **30 days** old, and they must be submitted within **48 h** of the request [S30].
6. **Returns.**
   - A return is a separate `RC` document whose `referenceUUID` = the original sale's `uuid` [S2][S30].
   - The ETA platform accepts returns up to 540 days after the sale [S5].
   - A receipt with status Valid cannot be edited or cancelled. Correct it by issuing a full return and then a new receipt [S30].
7. **Printed receipt.** It must show the UUID and a QR code [S30][S37]. QR content [S5]:
   - `{portalURL}/receipts/search/{uuid}/share/{dateTimeIssuedUTC}#Total:{totalAmount},IssuerRIN:{rin}`
8. **Restaurant taxes.**
   - VAT: `T1` with subtype `V009`, at **14%** where the restaurant is VAT-liable [S17][S33].
   - Service charge: `T9` with subtype `SC01` (rate) or `SC02` (amount) [S17][S30].
   - Prices must be entered **net of tax and fees**. Taxes and fees are added as `taxableItems` [S30].
   - In ETA's calculation model, `T9` is a "taxable fee", so it falls inside the VAT base [S7].
9. **Signatures.** Receipts do **not** need an e-signature today [S30]. Receipt signature validation is not deployed [S5][S12]. B2B e-invoices **do** need a CAdES-BES signature made with an ITIDA-licensed e-seal certificate [S25][S27][S35].

---

## 1. E-Receipt (منظومة الإيصال الإلكتروني) — B2C

### 1.1 Who must join, and the timeline

The Ministry of Finance timetable, announced 26 May 2022, phases in mandatory e-receipts for sales to final consumers [S32]:

| Phase | Date | Scope |
|---|---|---|
| Pilot | mid-April 2022 | voluntary "partners in success" |
| 2 | 1 Oct 2022 | about 400 taxpayers, Greater Cairo and Alexandria |
| 3 | mid-Jan 2023 | about 2,000 more taxpayers |
| **4.1** | **mid-Apr 2023** | **health, restaurants, hotels** |
| 4.2 | mid-Jul 2023 | transport, education, gold |
| 4.3 | mid-Oct 2023 | tobacco, appliances, clothing, … |
| 4.4 | mid-Jan 2024 | personal care, insurance, other services, … |
| 4.5 | mid-2024 | food and beverages, recreation, … |
| **5.1** | **mid-Jul 2024** | rest of Egypt; same sectors as 4.1, so **restaurants outside Greater Cairo and Alexandria** |
| 5.2–5.5 | Oct 2024 – Jul 2025 | rest of Egypt, other sectors |

How the obligation actually reaches a taxpayer:

- Each sub-phase is made binding by an ETA head decision that comes with a **named list of taxpayers**. Examples:
  - Decision 168/2023 for 4.1 and Decision 396/2023 for 4.2 (UNCONFIRMED: search snippets of eta.gov.eg news, not opened).
  - Decision 302/2024 for main phase 5 [S41].
  - Decision 455/2024, effective 15 Jan 2025 (secondary source, [S41]).
- In practice, a restaurant is obliged when it appears on a published list or is notified. It may also join voluntarily using the voluntary application form [S31][S30].
- A taxpayer named in a decision must register on the system by the obligation date. This applies even if its activity is seasonal or temporarily stopped [S30].
- Companies already on e-invoicing that also sell B2C must send the B2C sales as e-receipts and keep B2B sales on e-invoicing. A transaction must never be reported as both [S30].
- **Implication for Sufra:** every tenant needs both an e-receipt integration (POS sales) and, optionally, e-invoice issuance for corporate customers (see §2).

### 1.2 Onboarding and POS registration

Environments [S14]:

| Service | PreProd | Prod |
|---|---|---|
| Registration portal | https://profile.preprod.eta.gov.eg | https://profile.eta.gov.eg |
| Invoicing portal (also hosts receipts) | https://preprod.invoicing.eta.gov.eg | https://invoicing.eta.gov.eg |
| System API | https://api.preprod.invoicing.eta.gov.eg | https://api.invoicing.eta.gov.eg |
| Identity service | https://id.preprod.eta.gov.eg | https://id.eta.gov.eg |

- PreProd uses an internally issued CA, so test clients must trust `/files/preprod-root-ca.crt`. Do **not** install that certificate in production [S14].
- E-receipt and e-invoice share one platform and the same URLs [S30].

**Taxpayer prerequisites**

- The taxpayer profile must carry the **B2C tag**. Only B2C-tagged taxpayers can submit receipts [S8][S9].
- An e-invoice-registered company adds the B2C tag through its admin, or through the call centre on 16395 [S30].
- Branches must exist and be active in the "new tax business system" with matching **branch codes**. If branch data diverges, POS submissions stop working [S30].

**POS registration (prod)** [S30]

1. *POS bought from an ETA-approved vendor:*
   - Register the POS in the taxpayer profile (portal). It appears with status **Pending**.
   - Activate it by calling the **Authenticate POS** API.
2. *POS without an approved vendor, including a PC or software POS:*
   - Request an inspection visit at **https://pos.eta.gov.eg**.
   - The inspector (ETAX representatives) records the device.
   - Register the POS in the taxpayer profile; it is **Pending** until activated through Authenticate POS.
   - For a PC, register "Vendor name" = trade name of the device and "Model name" = the model. "Serial number" = the MAC address, the application serial or the device serial [S30].
3. *Preprod:*
   - Self-register through Taxpayer Profile → Add POS: choose the branch, choose model "Legacy Model", then enter the name, activation start date and a **unique serial number**.
   - The POS stays Pending until Authenticate POS is called [S30].

**Rules about POS identity** [S30]

- **Every device that issues receipts must be registered as a separate POS.** A whole outlet cannot be registered as one POS [S30].
- "Virtual POS" is acceptable [S30].
- An ERP may be registered as a single software POS **only** when the taxpayer has a single branch or outlet. With several outlets, every POS in every outlet must be registered [S30].
- **Implication for Sufra:** model each cashier terminal or tablet as its own ETA POS, with its own serial and its own `previousUUID` chain.
- A POS may move to another branch, but it must be re-linked to the new branch code before it issues receipts there [S30].
- Replacing a hard disk does not require re-registration [S30].

**Credentials** [S30]

- Each POS gets a **client_id / client_secret** from the taxpayer portal when it is registered.
- The secret can be regenerated when it expires or on demand.
- Even when an ERP submits, a POS-specific client id and secret are needed to activate that POS [S30].
- The same OS version value has to be entered on registration and in the `pososversion` header. In prod it is obtained from pos.eta.gov.eg; in preprod ask support on 16395 or at eReceipt.hd@eta.gov.eg [S30].

**Approved hardware** (relevant only if Sufra ships hardware) [S34]

- Cashier POS minimum: Intel i3, 4 GB RAM, 128 GB disk, Windows 10/Linux/Android, LAN, at least 3 USB ports, and a printer with Arabic font support.
- Handheld POS minimum: Android 6 or later, PCI PTS 5.x, a printer with 40 mm paper and Arabic font, and QR scanning.
- The POS software must be modifiable, meaning the source code is available [S34].
- The approved-vendor list is published at [S31].

### 1.3 Authentication (Authenticate POS)

`POST {identity-host}/connect/token` (identity service base, **not** the API base) [S8]

| Kind | Name | Notes |
|---|---|---|
| header | `posserial` | POS serial number, ≤100 chars [S8] |
| header | `pososversion` | POS OS version, ≤50 [S8] |
| header | `posmodelframework` | ≤10; FAQ: optional, omit [S30] |
| header | `presharedkey` | ≤200; FAQ: optional, omit, because sending it can make activation fail [S30] |
| body (form) | `grant_type` | `client_credentials` |
| body | `client_id` | ≤100 |
| body | `client_secret` | ≤100 |

**Success response (200)** [S8]

- `access_token`: a JWT that carries the taxpayer's tags (B2B / B2C).
- `token_type`: `Bearer`.
- `expires_in`: 3600 in the example.
- `scope`: for example `InvoicingAPI`.

**Errors (400 `error`)** [S8]

- `invalid_request`, `unauthorized_client`, `invalid_clientsecret`
- `invalid_posserial`, `invalid_pososversion`, `invalid_posmodelframework`, `invalid_presharedkey`
- `unsupported_grant_type`, `invalid_scope`

**Usage rules**

- Cache the token and refresh it before expiry. Calls without `client_id`/`grant_type`/`client_secret`, or with placeholder values, are blocked [S15].
- The first successful call activates a Pending POS [S30].
- "Device not active" errors mean one of two things: the POS has not been activated, or the `deviceSerialNumber` in the receipt does not match the registered serial [S30].
- ERP-style login (not POS): `POST /connect/token` with HTTP Basic `Authorization` built from client id and secret. An intermediary adds the header `onbehalfof: <RIN>` [S29]. Sufra could use this to act as an intermediary for e-invoices (UNCONFIRMED whether intermediaries may submit receipts).

### 1.4 Receipt JSON — Coffee & Restaurant Receipt v1.2 (`SC`)

Source for every row: [S1], unless another tag is given. M = mandatory, O = optional.

#### 1.4.1 Root

| Field | Type | M/O | Rule |
|---|---|---|---|
| `header` | object | M | see below |
| `documentType` | object | M | `receiptType` = `SC`, `typeVersion` = `"1.2"` |
| `seller` | object | M | |
| `buyer` | object | M | |
| `itemData` | array | M | 1..300 lines [S5] |
| `totalSales` | decimal | M | Σ `totalSale` |
| `totalCommercialDiscount` | decimal | O | Σ commercial + additional commercial discounts [S7] |
| `totalItemsDiscount` | decimal | O | Σ item + additional item discounts [S7] |
| `extraReceiptDiscountData` | array of discount | O | receipt-level discount |
| `netAmount` | decimal | M | Σ `netSale` |
| `feesAmount` | decimal | O | reserved, must be 0 |
| `totalAmount` | decimal | M | Σ line `total` − Σ extra discounts (+ `adjustment`) [S7] |
| `taxTotals` | **array** of `{taxType, amount}` | O | one entry per taxType; array per sample [S13] |
| `paymentMethod` | string(50) | M | code from §1.4.8 |
| `adjustment` | decimal | O | reserved, must be 0 |

Notes:

- The generic receipt v1.2 also has `contractor` `{name, amount, rate}` and `beneficiary` `{amount, rate}`, used for medical-insurance style splits [S3][S30].
- The Coffee & Restaurant v1.2 page does **not** list `contractor` or `beneficiary` [S1]. Do not send them on `SC`.

#### 1.4.2 `header`

| Field | Type | M/O | Rule |
|---|---|---|---|
| `dateTimeIssued` | datetime | M | **UTC**, ISO-8601 (e.g. `2022-02-03T00:00:00Z`); not in the future [S1][S5][S30] |
| `receiptNumber` | string(50) | M | unique per branch within a submission; the internal ERP number scheme is up to the company [S1][S30] |
| `uuid` | string(64) | M | SHA-256 hex (§1.5) |
| `previousUUID` | string(64) | M | previous receipt's uuid from the **same POS**; `""` only for the first receipt [S1][S5] |
| `referenceOldUUID` | string | O | for re-sending a corrected **Invalid** receipt (§1.7) |
| `currency` | string(3) | M | ISO-4217, normally `EGP` |
| `exchangeRate` | decimal | M if currency ≠ EGP | |
| `sOrderNameCode` | string | O | reference to a sales order; table says 200 chars, text says 30, so **use ≤30** |
| `orderdeliveryMode` | string(30) | **M (on SC)** | `FC` / `TO` / `TC` (§1.4.8) |

- On the generic receipt `orderdeliveryMode` is optional, and the generic receipt also has `grossWeight` and `netWeight` [S3].
- On the return types (`RC`) the header also has `referenceUUID` (M): the uuid of the original sale [S2].

#### 1.4.3 `documentType`

- `receiptType`: string(20). `SC` for a sale, `RC` for a return [S1][S2].
- `typeVersion`: string(100), `"1.2"`.

#### 1.4.4 `seller`

| Field | Type | M/O | Rule |
|---|---|---|---|
| `rin` | string(30) | M | taxpayer registration number; must equal the token's taxpayer [S5] |
| `companyTradeName` | string(200) | M | |
| `branchCode` | string(50) | M | branch code as registered with ETA; head office is usually `"0"` [S13] (UNCONFIRMED as a rule) |
| `branchAddress` | object | M | see below |
| `deviceSerialNumber` | string(100) | M | must equal the registered POS serial [S30] |
| `activityCode` | string(10) | M | from the activity code list, e.g. `5610` (§4.1) |

`branchAddress`:

- Mandatory:
  - `country` (2): `EG`
  - `governate` (100)
  - `regionCity` (100)
  - `street` (200)
  - `buildingNumber` (100)
- Optional:
  - `postalCode` (30)
  - `floor` (100)
  - `room` (100)
  - `landmark` (500)
  - `additionalInformation` (500)

The generic receipt also has an optional `syndicateLicenseNumber`, which does not apply to restaurants [S3].

#### 1.4.5 `buyer`

| Field | Type | M/O | Rule |
|---|---|---|---|
| `type` | string(1) | M | `P` natural person, `B` Egyptian business, `F` foreigner |
| `id` | string(30) | conditional | M if `type`=`B` (RIN); M if `type`=`P` **and** `totalAmount` ≥ **150,000 EGP** (national ID); for `F`, foreign ID |
| `name` | string | conditional | same condition as `id` (SC page: 200 chars; generic page: 100, so **use ≤100**) |
| `mobileNumber` | string(30) | O | |
| `paymentNumber` | string(30) | O | e.g. card authorisation code |

Threshold history and related rules:

- The 150,000 EGP threshold applies to v1.2+; it was 50,000 EGP for v1.0–1.1 [S5]. The FAQ PDF also states 150,000 EGP "currently" [S30].
- If the system-level "business buyer type restriction" is on, `B` is rejected [S5].
- Selling to a registered company should go through an **e-invoice**, not a receipt [S30].
- A company buyer **cannot deduct input VAT** on purchases evidenced only by an e-receipt; an e-invoice must be issued [S30].

Default for walk-in customers: `{"type":"P","id":"","name":""}`, the pattern shown in the SDK examples [S1].

#### 1.4.6 `itemData[]`

| Field | Type | M/O | Rule |
|---|---|---|---|
| `internalCode` | string(50) | M | Sufra menu item id / SKU |
| `description` | string(500) | M | |
| `itemType` | string(30) | M | `EGS` or `GS1` |
| `itemCode` | string(100) | M | approved EGS code (e.g. `EG-<RIN>-<code>`) or GS1 code (§3.4) |
| `unitType` | string(30) | M | unit code, e.g. `EA` (§3.5) |
| `quantity` | decimal | M | > 0, ≤5 dp |
| `unitPrice` | decimal | M | ≥ 0, ≤5 dp, **excluding** VAT and service [S30] |
| `totalSale` | decimal | M | `quantity × unitPrice` |
| `netSale` | decimal | M | `totalSale − Σ commercial − Σ additional commercial` |
| `total` | decimal | M | line total after taxes and discounts (formula §1.9) |
| `commercialDiscountData` | array of discount | O | before tax (reduces the tax base) |
| `additionalCommercialDiscount` | discount | O | applied after commercial discounts |
| `itemDiscountData` | array of discount | O | after tax (does **not** reduce the tax base) |
| `additionalItemDiscount` | discount | O | |
| `valueDifference` | decimal | O | ± ; adds to the tax base but not to the total [S30] |
| `taxableItems` | array of taxableItem | O | |

Discount object:

- `amount`: decimal, M, ≥ 0.
- `description`: string(50), M.
- `rate`: O, 0–100. If the rate is 0, `amount` wins [S1][S7].

TaxableItem object:

- `taxType`: string(30), M. Unique within the line.
- `subType`: string(50), M.
- `amount`: decimal, M.
- `rate`: decimal, O. Range 0–999, up to 2 dp [S1][S7].

ETA FAQ rules that matter for restaurants [S30]:

- **No negative lines and no "void" lines** in a receipt.
- Sale and return cannot be mixed in one document.
- One receipt per sale transaction. Receipts cannot be aggregated per product.
- Delivery fees cannot be sent as a `T12` "other fee". Add them as a normal **line item**.
- A 100% *item* discount combined with 14% VAT is acceptable. A 100% *commercial* discount is not the right mechanism for that case.
- Restaurant and delivery orders: **issue the receipt when the order is delivered** (handed over), not when it is placed.
- Partial prepayment: issue the receipt for the paid part including the tax due on the full item, and put the rest of the price in `valueDifference`.

#### 1.4.7 Batch wrapper (submission body)

```json
{
  "receipts": [ { /* receipt 1 */ }, { /* receipt 2 */ } ],
  "signatures": [ ]
}
```

- The wrapper is taken from the official sample batch [S13].
- `signatures` items are `{ "signatureType": "I"|"S", "value": "<base64 CAdES-BES>" }` [S9].
- Receipts need no signature [S30], and receipt signature validation is not deployed [S5][S12].
- Sending an empty array, as the official sample does, is the safe default (UNCONFIRMED whether omitting the key entirely is accepted).

#### 1.4.8 Code lists used by receipts

**Payment methods (`paymentMethod`)** [S18]

| Code | Meaning |
|---|---|
| `C` | Cash |
| `V` | Visa |
| `CC` | Cash with contractor |
| `VC` | Visa with contractor |
| `VO` | Vouchers |
| `PR` | Promotion |
| `GC` | Gift Card |
| `P` | Points |
| `O` | Others |

- There is only **one** `paymentMethod` per receipt.
- For split tender (cash plus card), the SDK defines no multi-tender structure. The suggested mapping (dominant method, or `O`) is UNCONFIRMED; ask ETA or the accountant.
- Map wallets (InstaPay, Vodafone Cash) to `O` or `V`. This mapping is UNCONFIRMED.

**Order delivery mode (`orderdeliveryMode`)** [S19]

| Code | Meaning | Suggested restaurant mapping |
|---|---|---|
| `FC` | From the company place | dine-in and takeaway |
| `TC` | Transported by the company | own delivery fleet |
| `TO` | Transport by others | aggregators (Talabat, etc.) |

The suggested mappings are Sufra's interpretation (UNCONFIRMED).

#### 1.4.9 Constructed example (Coffee & Restaurant sale, v1.2)

The SDK page for this type contains no full JSON example [S1]. The example below is **constructed** from the field tables [S1], the calculation rules [S7] and the official sample-batch layout [S13]. The `uuid` values are placeholders.

```json
{
  "receipts": [
    {
      "header": {
        "dateTimeIssued": "2026-10-12T18:45:00Z",
        "receiptNumber": "BR1-POS2-000154",
        "uuid": "<64-hex computed per §1.5>",
        "previousUUID": "<uuid of BR1-POS2-000153>",
        "referenceOldUUID": "",
        "currency": "EGP",
        "exchangeRate": 0,
        "sOrderNameCode": "T12-ORD-8812",
        "orderdeliveryMode": "FC"
      },
      "documentType": { "receiptType": "SC", "typeVersion": "1.2" },
      "seller": {
        "rin": "123456789",
        "companyTradeName": "Sufra Demo Restaurant",
        "branchCode": "1",
        "branchAddress": {
          "country": "EG",
          "governate": "Cairo",
          "regionCity": "Zamalek",
          "street": "26th of July St",
          "buildingNumber": "10"
        },
        "deviceSerialNumber": "SUFRA-POS-0002",
        "activityCode": "5610"
      },
      "buyer": { "type": "P", "id": "", "name": "" },
      "itemData": [
        {
          "internalCode": "MENU-0012",
          "description": "Koshary large",
          "itemType": "EGS",
          "itemCode": "EG-123456789-MENU0012",
          "unitType": "EA",
          "quantity": 2,
          "unitPrice": 50.00,
          "totalSale": 100.00,
          "netSale": 100.00,
          "total": 127.68,
          "taxableItems": [
            { "taxType": "T9", "subType": "SC01", "rate": 12, "amount": 12.00 },
            { "taxType": "T1", "subType": "V009", "rate": 14, "amount": 15.68 }
          ]
        },
        {
          "internalCode": "MENU-0040",
          "description": "Fresh lemon juice",
          "itemType": "EGS",
          "itemCode": "EG-123456789-MENU0040",
          "unitType": "EA",
          "quantity": 1,
          "unitPrice": 25.00,
          "totalSale": 25.00,
          "netSale": 25.00,
          "total": 31.92,
          "taxableItems": [
            { "taxType": "T9", "subType": "SC01", "rate": 12, "amount": 3.00 },
            { "taxType": "T1", "subType": "V009", "rate": 14, "amount": 3.92 }
          ]
        }
      ],
      "totalSales": 125.00,
      "totalCommercialDiscount": 0,
      "totalItemsDiscount": 0,
      "netAmount": 125.00,
      "feesAmount": 0,
      "totalAmount": 159.60,
      "taxTotals": [
        { "taxType": "T9", "amount": 15.00 },
        { "taxType": "T1", "amount": 19.60 }
      ],
      "paymentMethod": "C",
      "adjustment": 0
    }
  ],
  "signatures": []
}
```

Arithmetic check (per [S7]):

- Line 1: T9 = 100 × 12% = 12.00. T1 = (100 + 12) × 14% = 15.68. Total = 100 + 12 + 15.68 = 127.68.
- Line 2: T9 = 25 × 12% = 3.00. T1 = 28 × 14% = 3.92. Total = 31.92.
- Receipt: totalAmount = 127.68 + 31.92 = 159.60.

Whether VAT should apply on top of the 12% service charge is a **legal question**; see §3.2. If it should not, use `T17`/`SC03` (non-taxable service charge) instead of `T9`.

For contrast, the official generic batch sample [S13] is an older v1.0 `SR` example. It shows the `taxTotals` array, `extraReceiptDiscountData`, `contractor` and `beneficiary`. It also contains non-conforming values such as `paymentMethod: "Cash"` and `previousUUID: "0"`, so use it for layout only.

### 1.5 UUID generation (exact algorithm)

#### Steps

Per the Receipt Issuance FAQ, "How to generate receipt UUID" [S5]:

1. Take the complete receipt object, including `previousUUID` and, for returns, `referenceUUID`.
2. Set `header.uuid` to an empty string.
3. **Serialize** the receipt using the ETA *Document Serialization Approach* [S6], which flattens all properties into one line of text.
4. Compute SHA-256 over the serialized string. Use UTF-8 bytes, as in the signing guide [S27][S12].
5. Hex-encode the 32-byte digest into **64 hex characters**. That string is the `uuid`.

The core-fields validator checks that the uuid is a 64-char alphanumeric hash of the serialized receipt, excluding the uuid itself [S5].

#### Serialization rules [S6]

- Start at the **receipt object**, not the batch wrapper and not the `receipts` array.
- Walk the properties in document order. The page specifies no sorting.
- **Simple value:** emit `"` + value + `"`. The value is written **exactly as it appears in the JSON text**: `0.0` stays `0.0`, and `100.00` must not become `100`.
- **Object property:** emit `"` + NAME_IN_UPPERCASE + `"`, then the serialization of its children. No braces, colons or commas.
- **Array property:** emit `"` + NAME + `"` once. Then, for **each element**, emit `"` + NAME + `"` again followed by the element's serialization.
- Whitespace in the source JSON is not significant.
- JSON escapes in strings are not re-escaped.

Illustration (derived from the pseudocode on [S6]):

```
{"header":{"a":"1"},"items":[{"x":"2"},{"x":"3"}]}
→ "HEADER""A""1""ITEMS""ITEMS""X""2""ITEMS""X""3"
```

Reference pseudocode from [S6], JSON branch:

```
Serialize(node):
  if node is simple value: return "\"" + value + "\""
  s = ""
  foreach element in node:
    if element is not array:
      s += "\"" + upper(element.name) + "\"" + Serialize(element.value)
    else:
      s += "\"" + upper(element.name) + "\""
      foreach item in element:
        s += "\"" + upper(element.name) + "\"" + Serialize(item)
  return s
```

#### Implementation notes for Sufra

- **Freeze the exact JSON text** that will be submitted, then compute the uuid from that same text. Keep property order and number formatting identical. Recommendation: build the receipt with numbers pre-formatted to a fixed number of decimals, serialize to a string once, store that string, and hash and submit it verbatim.
- `uuid: ""` serializes as `"UUID"""` (empty quoted value). This follows from the rules; the SDK has no worked example (UNCONFIRMED: validate against preprod).
- Null or absent fields: omit them rather than sending `null`. How `null` is serialized is undocumented (UNCONFIRMED).
- Hex letter case is not specified. The SDK examples use **lowercase** (e.g. `68e656b251e67e8358bef8483ab0d51c6619f3e7a1a9f0e75838d41ff368f320`) [S5], so use lowercase.
- No official worked receipt → serialized → hash test vector exists on the public pages. The linked samples `/files/one-doc.json` and `one-doc-serialized` are invoice-oriented [S6].
- **Action:** build a unit test against preprod. Submit, then compare against ETA's recomputation. A mismatch is reported as "Valid UUID is required" [S30].

#### Chaining

- `previousUUID` = the uuid of the last receipt **or return** issued by the same POS. The chain is per POS, not per branch [S30].
- The first receipt of a POS has `previousUUID: ""` [S5].
- All receipts in one submission must come from the same POS [S5].
- Sufra must therefore keep, per POS, a strictly ordered issuance sequence that survives offline mode, app restarts and device replacement. Generating UUIDs in parallel on two devices that share a serial is forbidden.

### 1.6 Submission API

`POST {api-host}/api/v1/receiptsubmissions` with `Authorization: Bearer <token>` and `Content-Type: application/json` [S9].

| Item | Value |
|---|---|
| Receipts per submission | 1–500 [S5][S30] |
| Max submission size | 1.5 MB [S5][S30] |
| Max lines per receipt | 300 [S5][S30] |
| Same POS per batch | required [S5] |
| Success | **HTTP 202** with `submissionUUID`, `acceptedDocuments[]` {`uuid`,`longId`,`receiptNumber`}, `rejectedDocuments[]` {`receiptNumber`,`uuid`,`error`} [S9] |
| 400 `BadStructure` | structure error [S9] |
| 400 `MaximumSizeExceeded` | split the batch [S9] |
| 403 `IncorrectSubmitter` | submitter not allowed for this taxpayer [S9] |
| 422 `DuplicateSubmission` | identical payload within 10 min; honour `Retry-After` [S9] |
| 429 `TooManyRequests` | wait longer than `Retry-After` [S16] |
| 503 `ServiceUnavailable` | retry after ~1–3 s [S16] |

**Async status check**

- Status is reported asynchronously. Poll `GET /api/v1/receiptsubmissions/{submissionUuid}/details?PageNo=&PageSize=` [S10].
  - Submission `status`: `InProgress` | `Valid` | `Invalid`.
  - Per-receipt `status`: `Valid` | `Invalid` | `Cancelled`.
  - Errors carry `errorCode`, `error`, `errorAr` and `propertyPath`.
- Alternatively, expose the callback `PUT /notifications/receipts` to receive receipt events. ETA recommends callbacks over polling [S15][S11].
- General notifications report events such as **POS credential expiry, POS date expiry and POS deactivation** [S11]. Surface them to tenant admins.

**Retry rules** [S15]

- Never resubmit after a 2xx response.
- Do not poll with Get Receipt or Search Receipts.
- Rate limits on reads: Get Receipt, Get Receipt Details and Search Receipts allow 2 req/s per POS/ERP; Get Recent Receipts allows 3 req/s [S16].

**Batch with an invalid receipt**

- The FAQ PDF says that if any receipt in a batch is invalid, the **whole batch is considered invalid** and must be resent (valid receipts unchanged) [S30].
- The API nonetheless returns per-document accepted/rejected lists [S9].
- Treat this as a conflict between sources (UNCONFIRMED in practice). Safest approach: small batches, and a retry that re-sends the unchanged valid receipts with their original uuids.

### 1.7 Offline mode, late submission, corrections, returns, cancellation

**Offline**

- Receipts **may be issued offline** and printed for the customer, then uploaded later [S30].
- The upload must happen within **24 hours** of issuance (UTC) [S5][S30]. The legal principle is real-time sending; the 24 h window is a tolerance, and ETA can act on late sending [S30].
- These checks can run offline before storing a receipt [S5]:
  - JSON structure
  - Codes, against cached code tables
  - Core fields
- Emergency options for an internet outage [S30]:
  1. Store the receipts on the POS and send them on reconnect, using a backup connection if necessary.
  2. Export the receipts as JSON from the POS or ERP and upload them through the **portal**.
  3. Use the late submission feature.

**Late submission** (window missed)

- Raise a *Late Submission Request* on the portal (e-invoicing portal → receipts → late receipt requests).
- Receipts up to **30 days** old are then accepted.
- They must be sent within **48 hours** of the request [S30].
- Requests consume a yearly quota; the number is configurable and not published [S5].
- Only one active request at a time [S5].
- The POS must re-authenticate, getting a new token, after approval [S5].
- Late receipts are flagged as late [S5].

**Correcting an *Invalid* receipt** [S5][S30]

- Fix the receipt and give it a **new uuid**.
- Keep the **same `previousUUID`** as the invalid one.
- Set `referenceOldUUID` = the invalid receipt's uuid. If the receipt was corrected several times, use the uuid of the **first** receipt that was printed for the consumer [S30].
- Later receipts in the chain are **not** changed.
- Window: within **96 h** if the old uuid matches a previously invalidated document, or **72 h** if it does not match. After 96 h, use late submission [S5][S30].
- `referenceOldUUID` must not equal `uuid` [S5].

**Valid receipts cannot be modified** [S30]

- To fix a mistake, including a wrong tax amount, issue a **full return** and then a new receipt [S30].
- E-receipts have no "cancel" API for taxpayers. The receipt status list does include `Cancelled` [S10], but it is set by the platform; the trigger is UNCONFIRMED.
- E-invoice cancellation is different; see §2.

**Returns (`RC`)**

- `header.referenceUUID` = the uuid of the original sale, which must be of the matching type (an `SC` sale for an `RC` return) and must already have been processed [S2][S5][S30].
- Return lines must use the **same unit price** as the sale. A higher price raises error `RR316` [S30].
- A bad reference raises `RR304 Reference UUID is invalid` [S30].
- Time limits:
  - The platform accepts returns up to **540 days** (≈18 months) after the sale [S5][S30].
  - Consumer-protection law sets a 30-day return right; that is a business policy, not an ETA limit [S30].
  - For sales made before the taxpayer joined, a return is allowed if the sale is no more than 30 days before joining [S30].
- "Return Receipt Without Reference v1.2" exists, with a reason code list (`/codes/return-with-no-reference-reasons-type/`) [S4]. It is not specific to restaurants; prefer referenced returns.
- Returns also take part in the POS `previousUUID` chain [S30].

### 1.8 Printed receipt and QR code

**Legal basis**

- Law 206/2020 art. 37 requires every invoice or receipt to show [S36]:
  - serial number and issue date
  - seller name, address and registration number
  - buyer data if any
  - goods or services, their value, tax category and tax amount, and the total
- The Executive Regulations (Minister of Finance Decree **286/2021**), art. 42, add [S37]:
  - the unified **item code**
  - buyer type and identity, with the national ID above the threshold
  - **activity code** and **branch code**
  - exchange rate (for foreign currency)
  - **UUID**
  - quantity
  - tax types and fees
  - **QR code**
- For receipts, art. 42 also requires [S37]:
  - **POS serial number**
  - **payment method**
  - **reference ID for returns**
  - payment or subscriber number for utility receipts
- The ETA FAQ confirms that the printed receipt must include the UUID and the system QR code, so the consumer can look the receipt up [S30].
- The texts above come from secondary hosts of the decree and law; verify them against the Official Gazette (UNCONFIRMED wording).

**QR content** [S5]

```
{eInvoicingPortalURL}/receipts/search/{UUID}/share/{ReceiptDateAndTimeUTC}#Total:{Total},IssuerRIN:{RIN}
```

Official example, one line:

```
http://invoicing.eta.gov.eg/receipts/search/68e656b251e67e8358bef8483ab0d51c6619f3e7a1a9f0e75838d41ff368f320/share/2022-02-19T02:00Z#Total:1000.000,IssuerRIN:674859545
```

- The date-time is the UTC issuance time. The example uses the format `yyyy-MM-ddTHH:mmZ` [S5].
- Use the portal URL for the environment: `https://invoicing.eta.gov.eg` in prod and `https://preprod.invoicing.eta.gov.eg` in preprod [S14].
- Print the **QR image only**; the underlying string is not printed [S30].
- Returns get their own QR as well [S30].
- The uuid is available offline because it is computed locally, so the QR can be printed **before** submission.

**Recommended printed layout** (UNCONFIRMED as to an official template; derived from art. 37/42)

- Trade name, RIN, branch code and address, activity code
- POS serial, receipt number, UTC-based date and time (shown in local time)
- Line items: code, name, quantity, unit price, net
- Discounts
- Service charge (T9) and VAT (T1) separately
- Total
- Payment method, buyer type, ID when required
- UUID (full 64 characters, or wrapped)
- QR code
- For returns: the reference UUID of the original sale

### 1.9 Calculations, rounding and tolerance

Main calculations, numbered as in [S7]:

- `totalSale = quantity × unitPrice` (rule 11)
- commercial discount amount = `rate × totalSale / 100` when the rate is > 0 (rule 44)
- additional commercial = `rate × (totalSale − Σcommercial) / 100` (rule 46)
- `netSale = totalSale − Σcommercial − Σadditional commercial` (rule 13)
- item discount = `rate × netSale / 100` (rule 45)
- additional item = `rate × (netSale − Σitem) / 100` (rule 47)
- `TotalTaxableFees` = Σ amounts of **T5–T12**, which are added before VAT. `NonTaxableFees` = Σ **T13–T20**, which are added only to the line total (rule 17).
- `T2 = (netSale + TotalTaxableFees + valueDifference) × rateT2 / 100` (rule 40)
- `T3`: fixed amount; its rate must be 0 or absent (rule 41)
- `T1 = (T2 + netSale + TotalTaxableFees + valueDifference + T3) × rateT1 / 100` (rule 42)
- `total = netSale + T3 + TotalTaxableFees + T2 + T1 − Σitem discounts − Σadditional item − T4 + NonTaxableFees` (rule 17)
- `totalSales = Σ totalSale`; `netAmount = Σ netSale`; `totalCommercialDiscount = Σ(commercial + additional commercial)` and must be ≤ `totalSales`; `totalItemsDiscount = Σ(item + additional item)`
- extra receipt discount = `rate × netAmount / 100`
- `totalAmount = Σ total − Σ extraReceiptDiscount + adjustment` (rule 29)
- `taxTotals[taxType] = Σ` line amounts of that type

Precision and tolerance:

- Up to **5 decimals** for quantities, prices and totals. Tax rates allow up to 2 decimals and a range of 0–999 [S7].
- The FAQ: up to 5 decimal places are accepted, rounding happens after the 5th decimal, and rates go up to 999% [S30].
- The receipt page says `taxableItems.amount` has "precision of 2" and `taxTotals.amount` has up to 5 [S1][S3]. Recommendation: round tax amounts to 2 dp at line level and sum them exactly.
- **Tolerance:** "All the above calculations are subject to (± 0.5) tolerance" [S7]. The unit is not stated; presumably currency units (EGP).
- The FAQ also lists validation errors when header discount totals differ from the sum of lines (e.g. `SF350`) [S30].

Rounding method: not specified beyond the above. Recommendation: banker's rounding is not mandated, so use half-up at 2 dp for money (UNCONFIRMED).

---

## 2. E-Invoice (منظومة الفاتورة الإلكترونية) — B2B

### 2.1 When a restaurant needs it

**Sales side**

- When the buyer is a registered company (a corporate client, catering for a company, office lunches billed to a company), issue an **e-invoice**, not a receipt.
- The company cannot deduct input VAT on an e-receipt [S30].
- A transaction must not be reported on both systems [S30].
- Sales to a company's employee can be handled either way: an e-invoice to the company, or an e-receipt in the employee's name [S30].

**Purchase side**

- Suppliers must issue e-invoices to the restaurant. Purchases without an e-invoice do not support input-VAT deduction [S30].
- Sufra should therefore be able to **import and reconcile** supplier e-invoices. Use the Search Documents and Get Document APIs [S11 → /einvoicingapi/].

**Portal option**

- Companies issuing at most 200 invoices per month may issue e-invoices manually on the portal instead of integrating [S30].
- That makes the B2B integration a "phase 2" feature for Sufra.

### 2.2 Document types

| `documentType` | Meaning | Version | Source |
|---|---|---|---|
| `i` | Invoice | `"1.0"` | [S25] |
| `c` | Credit note; optional `references[]` = uuids of the original invoices | `"1.0"` | [S26] |
| `d` | Debit note (structure mirrors the credit note) | `"1.0"` | (UNCONFIRMED page detail) |
| — | Export invoice, credit and debit variants also exist | | [S23] |

Credit-note rules [S26]:

- The issuer, receiver and activity code are the same as on the referenced invoices.
- The referenced invoices were issued earlier, to the same receiver.
- The credit-note lines match the invoice lines; only quantities and amounts change.
- The credit-note total is ≤ the total of the referenced invoices.

### 2.3 Structure summary (invoice v1.0) [S25]

**Root fields**

- `issuer`, `receiver`
- `documentType`, `documentTypeVersion`
- `dateTimeIssued` (UTC, not in the future)
- `taxpayerActivityCode`, `internalID`
- `purchaseOrderReference`, `salesOrderReference`, `payment`, `delivery` (all optional)
- `invoiceLines[]`
- `totalDiscountAmount`, `totalSalesAmount`, `netAmount`, `taxTotals[]`
- `extraDiscountAmount`, `totalItemsDiscountAmount`, `totalAmount`
- `signatures[]`

The SDK page renders the internal-id field as `internalId` and the branch field as `branchId`. Use the casing from the official sample JSON (UNCONFIRMED).

**Issuer and receiver**

- `issuer`: `type` (`B`), `id` (RIN), `name`, `address` {`branchID`, `country`, `governate`, `regionCity`, `street`, `buildingNumber`, `postalCode`, `floor`, `room`, `landmark`, `additionalInformation`}.
- `receiver`: same structure without the branch id.
  - `type` is `B`, `P` or `F`.
  - For `B` the id is the RIN, for `P` the national ID, for `F` the foreign VAT/ID.
  - For `P` below a threshold, id, name and address can be omitted. The threshold is not stated on the page (UNCONFIRMED; commonly cited as 50,000 EGP).

**Invoice lines**

- `description`, `itemType` (`GS1`/`EGS`), `itemCode`, `unitType`, `quantity`
- `unitValue` {`currencySold`, `amountEGP`, `amountSold`, `currencyExchangeRate`}
- `salesTotal`, `discount` {`rate`, `amount`}, `netTotal`, `valueDifference`, `totalTaxableFees`, `itemsDiscount`
- `taxableItems[]` {`taxType`, `amount`, `subType`, `rate`}
- `total`, `internalCode`

The same formulas as in §1.9 apply, documented in [S28]. For example:

- `T1 = (NetTotal + TotalTaxableFees + ValueDifference + T2 + T3) × rate`
- WHT `T4 = rate × (NetTotal − ItemsDiscount)`
- `TotalAmount = Σ line Total − ExtraDiscountAmount`

### 2.4 Signing (mandatory for e-invoices)

**What gets signed** [S25][S27]

- The issuer signature covers the whole document **except** `signatures`. It is `signatures[]` = `{ "signatureType": "I", "value": "<base64 CAdES-BES>" }`.
- An optional service-provider signature `S` covers the document plus the `I` signature.
- Process: canonicalize with the same serialization as §1.5, SHA-256 the UTF-8 bytes, sign with **CAdES-BES**, and Base64 the result. `.NET SignedCms` is cited as an option.

**Certificate** [S25][S35]

- Use an **e-Seal certificate**, bound to the legal entity, from an **ITIDA-licensed** certification provider. The provider list is linked from ETA's guide [S35].
- The certificate must be valid on the submission date, issued to the taxpayer, and belong to an active representative [S25].
- Typical forms are a USB token or an HSM / e-seal server [S35].
- **Implication for Sufra (cloud):** signing needs either a per-tenant HSM/e-seal server or a local signing agent where the tenant's USB token is plugged in. This is an architecture decision to make early.
- The legal basis for the e-signature requirement is cited as Ministerial Decree **188/2020** (secondary source; UNCONFIRMED).

### 2.5 Submission and lifecycle

- **Submit:** `POST {api-host}/api/v1.0/documentsubmissions` with body `{"documents":[...]}`. Response 202 with `submissionUUID`, `acceptedDocuments[]` {`uuid`,`longId`,`internalId`} and `rejectedDocuments[]`. Errors: `BadStructure`, `MaximumSizeExceeded`, `IncorrectSubmitter`, `DuplicateSubmission` (10 min), and `Forbidden` (tag "B2B Deny ERP Submission") [S23].
- **Status:** use Get Submission (`/einvoicingapi/09-get-submission/`), or the notification callback `PUT /notifications/documents` [S15].
- **Cancel:** `PUT /api/v1.0/documents/state/{UUID}/state` with body `{"status":"cancelled","reason":"..."}` [S24].
  - The cancellation window is per document type and returned by the Get Document Type API workflow parameters [S24]. The exact number of days is UNCONFIRMED; it is commonly cited as 7 days.
  - Errors: `OperationPeriodOver`, `IncorrectState`, `ActiveReferencingDocuments` (cancel referencing credit notes first), `TryingToCancelFreezedDocument`.
- **Receiver actions:** the receiver can **reject** within a window, and the issuer can decline that rejection [S11 → /einvoicingapi/03, 13].
- **Issuance window:** the maximum age of `dateTimeIssued` is UNCONFIRMED; it is set as a document-type workflow parameter.
- **Rejected invoices:** the issuer may issue a new invoice without a credit note, because a rejected invoice is treated as cancelled [S30].

---

## 3. Tax codes for restaurants

### 3.1 ETA tax type list [S17]

| Code | Name | Subtypes |
|---|---|---|
| **T1** | Value added tax | V001 Export · V002 Export to free areas · V003 Exempted good/service · V004 Non-taxable good/service · V005 Diplomats exemption · V006 Defence/national security · V007 Agreements exemption · V008 Special exemptions · **V009 General item sales** · V010 Other rates |
| T2 | Table tax (percentage) | Tbl01 |
| T3 | Table tax (fixed amount) | Tbl02 |
| T4 | Withholding tax (WHT) | W001 Contracting … W016 Advance payment (W002 Supplies, W003 Purchases, W004 Services, W010 Professional fees, …) |
| T5 | Stamping tax (percentage) | ST01 |
| T6 | Stamping tax (amount) | ST02 |
| T7 | Entertainment tax | Ent01 rate / Ent02 amount |
| T8 | Resource development fee | RD01 rate / RD02 amount |
| **T9** | **Service charges** | **SC01 rate / SC02 amount** |
| T10 | Municipality fees | Mn01 / Mn02 |
| T11 | Medical insurance fee | MI01 / MI02 |
| T12 | Other fees | OF01 / OF02 |
| T13–T20 | **Non-taxable** versions of T5–T12 (not in the VAT base) | ST03/ST04, Ent03/Ent04, RD03/RD04, **SC03/SC04**, Mn03/Mn04, MI03/MI04, OF03/OF04 |

### 3.2 What applies to a restaurant or cafe

**VAT `T1` / `V009` at 14%** [S33]

- ETA notice of 18 May 2025:
  - **Tourist restaurants** licensed by the Ministry of Tourism are subject to VAT at the general rate of **14%**.
  - **Non-tourist restaurants** are subject to VAT only when they reach the registration threshold and meet the conditions of Minister of Finance Decrees **82/2017** and **285/2021**. Otherwise the food and drink they sell to the final consumer is exempt under item 16 of the exemption schedule of VAT Law **67/2016**.
- The categories that must charge VAT under those decrees:
  1. Venues in malls, residential compounds, tourist sites or airports.
  2. Chains, or venues using a well-known local or international trademark.
  3. Venues selling through apps or websites.
  4. Venues offering tourist-standard meals or services, **or that charge a service fee**.
- Rate check: 14% is still the general rate according to ETA in May 2025 [S33]. Secondary sources say Law 157/2025 amended the VAT law without changing 14% (UNCONFIRMED from a primary source).
- **Exempt (non-VAT) restaurants:** send no `T1` line, or `T1` with an exemption subtype such as `V003`/`V004` and rate 0. Which one ETA expects is UNCONFIRMED; ask the accountant.
- The VAT registration threshold is commonly cited as 500,000 EGP annual turnover. The ETA notice does not state the figure (UNCONFIRMED).
- **Per-tenant setting needed:** `vatRegistered` (bool) plus the default `T1` subtype and rate.

**12% service charge ("خدمة")**

- *Is it allowed?*
  - It is customary in tourist establishments and treated in labour law as a service percentage distributed to workers. Minister of Labour Decree **177/2024** on distributing service proceeds in tourist and hotel establishments replaced Decree 125/2003 after a Constitutional Court ruling (secondary sources [S40]).
  - Consumer protection requires the final price including service to be disclosed (secondary [S39]).
  - Cafes under the Central Administration for Tourism and Resorts reportedly may *not* impose minimum charge or service (secondary; UNCONFIRMED).
  - **No ministerial decree making it mandatory or fixing it at 12% was located in a primary source (UNCONFIRMED).**
- *How to send it to ETA:* the ETA FAQ says to enter the item price **without** any tax or fee and to add service as a tax/fee type: "**رسم الخدمة يتم اختيار نوع الضريبة T9**" ("for the service charge, select tax type T9") [S30]. So the service charge **is** a code in the receipt: `T9` + `SC01` at rate 12.
- *VAT on top of service:*
  - In ETA's calculation model, T5–T12 are "taxable fees" that enter the T1 base [S7][S28]. Using `T9` therefore means VAT is computed on (net + service).
  - Industry statements describe the customer bill as 12% service + 14% VAT (secondary [S39]).
  - A non-taxable service code `T17`/`SC03` exists [S17].
  - **Which one is legally correct (is the service charge part of the VAT taxable value under Law 67/2016 art. 11 — UNCONFIRMED) is an open question for the accountant (§5.3).**
  - Default in Sufra: `T9`, configurable per tenant to `T17`.

**Table tax `T2`/`T3`**

- Applies only to goods on the VAT law's table schedule (e.g. tobacco, alcohol), not to ordinary food (UNCONFIRMED: the schedule was not reviewed).
- Model it as a per-menu-item optional tax.

**Tourism / development fees**

- Law 83/2020 (amending the resource-development-fee law) imposes a **12% fee on the cost of parties and entertainment services** held in hotels, tourist venues and public places. It is collected and remitted to the Tax Authority (secondary [S38]).
- On a receipt it would map naturally to `T8` (`RD01`). That mapping is UNCONFIRMED; it is only relevant for event bookings.
- `T7` Entertainment tax may apply to venues with shows (UNCONFIRMED).
- `T10` Municipality fees may apply depending on governorate/tourist classification (UNCONFIRMED).
- Make all of these per-tenant, per-item configurable.

**Delivery fee**

- Must be a separate line item, not a `T12` fee [S30].
- It needs its own EGS service code.

### 3.3 Price entry rule

Prices in the receipt must be **pre-tax**. VAT-inclusive prices are not allowed; the tax is added as `taxableItems` [S30].

Restaurant menus in Egypt usually show prices excluding service and VAT, or sometimes including them. Sufra must therefore back-calculate when menu prices are tax-inclusive: `unitPrice = gross / ((1 + s) × (1 + v))` when VAT applies on service. Watch the ±0.5 tolerance and the 5-dp limits.

### 3.4 Item codes (EGS / GS1)

- Both systems use the same coding: **GS1** or **EGS** [S30].
- **EGS registration:** `POST /api/v1.0/codetypes/requests/codes` with `items[]` [S22]:
  - `codeType: "EGS"`
  - `parentCode`: a level-4 GPC code (e.g. `10000051`)
  - `itemCode`: `"EG-<TaxpayerRIN>-<InternalCode>"`
  - `codeName`, `codeNameAr`, `activeFrom` (UTC); optional `activeTo`, `description`, `descriptionAr`, `requestReason`, `linkedCode`
- ETA staff approve codes, with an SLA of about **15 days** [S30]. Codes cannot be edited afterwards: expire the old one (set `activeTo`) and register a new one [S30].
- **Until EGS codes are approved:** use `itemType: "GS1"` and put the **GPC Brick (level-4) code** in `itemCode` [S30].
- All products and services sold must be coded [S30]. Codes registered for e-invoicing can be bulk-loaded onto POS without re-approval [S30].
- **Sufra design:**
  - Store `etaItemType`, `etaItemCode` and `gpcBrick` per menu item. Modifiers that change the price should be separate coded lines, or folded into the parent line price (UNCONFIRMED best practice).
  - Provide bulk EGS registration from the menu.
  - Store the status per code: pending / approved / rejected / expired.
- Searching published codes is rate-limited to 1 request per 10 s, and "my code requests" to 1 per 5 s [S16].

### 3.5 Unit types [S20]

The unit list has 144 rows. The relevant ones:

| Code | Meaning |
|---|---|
| **`EA`** | each — the default for dishes and drinks |
| `C62` | activity unit — usable for services |
| `KGM` | kilogram |
| `GRM` | gram |
| `LTR` | litre |
| `MLT` | millilitre |
| `BOX` | box |
| `CT` | carton |
| `DZN` | dozen |
| `PR` | pair |
| `SET` | set |

`PCE`, `H87` and `BX` are **not** valid codes [S20].

---

## 4. Related obligations

### 4.1 Activity codes [S21]

The activity code is 4 digits (ISIC-based); use it in `seller.activityCode` and the e-invoice `taxpayerActivityCode`.

| Code | Description |
|---|---|
| **5610** | Restaurant service and food delivery activities by mobile means (انشطة خدمات المطاعم وتوصيل الطعام بالوسائل المتحركة) |
| 5621 | Event catering |
| 5629 | Other catering services activities |
| **5630** | Light beverage service activities (cafes / coffee shops) |
| 5510 / 5520 / 5590 | Accommodation (hotel restaurants may use the hotel's code) |

The code must be one registered for the taxpayer and branch. The taxpayer validator checks branch activity dates [S5].

### 4.2 Record retention and penalties

- Law 206/2020 art. 38 requires keeping books, records and documents, including invoice copies, for **5 years following the tax period** [S36].
- Art. 37 requires keeping originals and copies of cancelled invoices and receipts [S36].
- The law was amended later (Law 176/2022, Law 7/2025), so re-verify the current text (UNCONFIRMED).
- **Sufra must keep, for at least 5 years plus the current period:**
  - the exact submitted JSON
  - the uuid, submissionUUID, longId and ETA status history
  - the printed receipt data
- Penalties: art. 71 sets a fine of 20,000–100,000 EGP for breaching art. 37 paragraphs 1 and 4, which include the obligation to issue electronic invoices or receipts [S36]. The current amounts are UNCONFIRMED after the 2022 and 2025 amendments.
- ETA reserves the right to take legal action when receipts are not sent in real time without an acceptable reason [S30].

### 4.3 Z-reports and daily closing

- **No ETA requirement for a Z-report or daily fiscal closing was found** in the SDK or the FAQ (UNCONFIRMED: absence of evidence).
- Reconciliation is done against the portal: the taxpayer can export the receipts grid or request receipt packages as CSV or JSON [S30][S11 → /ereceiptapi/11–13].
- Recommendation: a daily job that compares local receipts with ETA (Search Receipts or packages) and flags missing, invalid or late receipts.

### 4.4 Other items

- POS hardware certification and vendor approval: see [S34] and [S31].
- ETA also runs a "Multi-Vendor Monitoring System" for POS (PDF linked on [S31]; not reviewed, UNCONFIRMED relevance).
- Support channels: hotline **16395**, eReceipt.hd@eta.gov.eg [S31][S30]. For questions about RINs of government entities, use einv-RIN@eta.gov.eg [S30].
- All submissions use **UTC** timestamps [S30]. Egypt local time is UTC+2, or UTC+3 in summer (DST), so convert carefully, especially for the 24 h window and the QR date.

---

## 5. Implementation checklist

### 5.1 Configuration

**Per tenant (legal entity)**

- `rin`: taxpayer registration number (9 digits typical).
- `companyTradeName`, exactly as registered.
- Environment: `preprod` | `prod`, with the base URLs from §1.2.
- `vatRegistered`, the default VAT subtype and rate (`V009`/14), and the exempt subtype if not registered.
- Service charge policy:
  - enabled, rate (default 12)
  - tax code `T9`/`SC01` or `T17`/`SC03`
  - apply to dine-in only or to all order types
- Optional fees per item or order type (`T2`/`T3`/`T7`/`T8`/`T10`/`T12`).
- Price entry mode: tax-exclusive or tax-inclusive (back-calculation).
- B2B e-invoicing: enabled, ERP `client_id`/`client_secret` (stored encrypted), signing method (HSM, token agent, none), and certificate metadata.
- Buyer-ID threshold (default 150,000 EGP; configurable because ETA can change it).
- Payment method mapping (Sufra tender → ETA code).
- Order type → `orderdeliveryMode` mapping.

**Per branch**

- `branchCode` (as on the ETA portal) and `branchAddress` (country, governate, regionCity, street, buildingNumber, plus optional fields).
- `activityCode` (e.g. 5610 or 5630).

**Per POS (device)**

- `deviceSerialNumber` / `posserial` (unique)
- `pososversion`, `posmodelframework` (optional), `presharedkey` (optional)
- `client_id`, `client_secret` (encrypted; can be rotated)
- ETA POS status (pending / active / deactivated)
- The last issued `uuid` (chain head) and a monotonic local sequence
- Token cache with expiry

**Per menu item**

- `internalCode`, `description` (Arabic and English), `itemType`, `itemCode`, `gpcBrick`, `unitType`
- EGS approval status
- Applicable taxes or fees

### 5.2 What to store per receipt (immutable once issued)

- Tenant, branch and POS ids. Document type (`SC`/`RC`) and version.
- `receiptNumber`, `dateTimeIssued` (UTC) and the local time.
- `uuid`, `previousUUID`, `referenceUUID` (returns), `referenceOldUUID` (corrections).
- The **exact JSON string** submitted, with its SHA-256, and the serialized pre-image (useful for debugging).
- The QR string.
- Submission records: `submissionUUID`, submit timestamp, attempt count, HTTP results.
- ETA results: `longId`, per-receipt status (`Submitted`/`Valid`/`Invalid`/`Cancelled`), and the error list (code, message, Arabic message, property path) with timestamps.
- Flags: offline-issued, late-submission, corrected-by (link to the corrected receipt).
- Buyer data when supplied (national ID: encrypt and minimise access).
- Retention: at least 5 years after the tax period.

**Engine behaviours**

- A per-POS FIFO queue.
- Batches of up to 500 receipts or 1.5 MB, from the same POS.
- Exponential backoff that honours `Retry-After`; never resend after a 2xx.
- Alerts at, for example, 12 h and 20 h of unsent receipts, ahead of the 24 h deadline.
- A late-submission workflow.
- Handling of the POS credential-expiry and deactivation notifications.

### 5.3 Open questions for the tax accountant

1. Are this tenant's outlets VAT-liable under Decrees 82/2017 and 285/2021 (mall, chain or brand, app sales, service charge)? If exempt, which `T1` subtype or rate should be sent, if any?
2. Is VAT due on the 12% service charge? Should it be `T9` (in the VAT base) or `T17` (outside it)? What is the legal basis (Law 67/2016 art. 11)? Is there an ETA ruling?
3. Is the 12% service charge permitted for this specific establishment (tourist vs non-tourist licence)? Which decree governs it?
4. Do any of `T7` (entertainment), `T8` (development fee on events), `T10` (municipality) or table tax apply to this outlet's menu or events?
5. Split tender (cash plus card) and wallets: which `paymentMethod` code?
6. Tips, gratuity, and gift card sales and redemption: how to receipt them? Receipt at gift-card sale or at redemption?
7. Staff meals, complimentary items, and 100% discounts: item discount vs commercial discount treatment.
8. Aggregator orders (Talabat, etc.): who issues the receipt, the restaurant or the platform? What is `orderdeliveryMode`, and how should commission invoices be handled (e-invoice from the aggregator)?
9. Corporate and catering customers: thresholds and processes for e-invoice vs receipt, and the e-seal procurement route (token or HSM).
10. Retention period and format acceptable for archived receipts, and whether a daily Z-report is expected by the local tax office (no ETA requirement found).

---

## Sources

Primary sources (ETA SDK, eta.gov.eg):

- **[S1]** Coffee & Restaurant Receipt v1.2: https://sdk.invoicing.eta.gov.eg/documents/coffee-restaurant-receipt-v1-2/
- **[S2]** Coffee & Restaurant Return Receipt v1.2: https://sdk.invoicing.eta.gov.eg/documents/coffee-restaurant-return-receipt-v1-2/
- **[S3]** Receipt v1.2 (generic): https://sdk.invoicing.eta.gov.eg/documents/receipt-v1-2/
- **[S4]** Document types index (retired and current versions): https://sdk.invoicing.eta.gov.eg/types/
- **[S5]** Receipt Issuance FAQ: https://sdk.invoicing.eta.gov.eg/receiptissuancefaq/
- **[S6]** Document Serialization Approach: https://sdk.invoicing.eta.gov.eg/document-serialization-approach/
- **[S7]** Main Calculations (receipts): https://sdk.invoicing.eta.gov.eg/main-calculations/
- **[S8]** Authenticate POS: https://sdk.invoicing.eta.gov.eg/ereceiptapi/01-authenticate-pos/
- **[S9]** Submit Receipt Documents: https://sdk.invoicing.eta.gov.eg/ereceiptapi/02-submit-receipt/
- **[S10]** Get Receipt Submission: https://sdk.invoicing.eta.gov.eg/ereceiptapi/06-get-receipt-submission/
- **[S11]** eReceipt API index (incl. notifications, packages): https://sdk.invoicing.eta.gov.eg/ereceiptapi/ and eInvoicing API index: https://sdk.invoicing.eta.gov.eg/einvoicingapi/
- **[S12]** Receipt batch signature creation: https://sdk.invoicing.eta.gov.eg/receipt-batch-signature-creation/
- **[S13]** Official sample batch: https://sdk.invoicing.eta.gov.eg/files/BatchReceipt.json
- **[S14]** SDK FAQ (environment URLs): https://sdk.invoicing.eta.gov.eg/faq/
- **[S15]** Integration Practices: https://sdk.invoicing.eta.gov.eg/integrationpractices/
- **[S16]** APIs Governance & Rate Limiting: https://sdk.invoicing.eta.gov.eg/apigovernance/
- **[S17]** Tax Types: https://sdk.invoicing.eta.gov.eg/codes/tax-types/
- **[S18]** Payment Methods: https://sdk.invoicing.eta.gov.eg/codes/payment-methods/
- **[S19]** Order Delivery Modes: https://sdk.invoicing.eta.gov.eg/codes/delivery-mode/
- **[S20]** Unit Types: https://sdk.invoicing.eta.gov.eg/codes/unit-types/
- **[S21]** Activity Types: https://sdk.invoicing.eta.gov.eg/codes/activity-types/
- **[S22]** Create EGS Code Usage: https://sdk.invoicing.eta.gov.eg/api/09-create-egs-code-usage/
- **[S23]** Submit Documents (e-invoice): https://sdk.invoicing.eta.gov.eg/einvoicingapi/01-submit-documents/
- **[S24]** Cancel Document: https://sdk.invoicing.eta.gov.eg/einvoicingapi/02-cancel-document/
- **[S25]** Invoice v1.0: https://sdk.invoicing.eta.gov.eg/documents/invoice-v1-0/
- **[S26]** Credit Note v1.0: https://sdk.invoicing.eta.gov.eg/documents/credit-note-v1-0/
- **[S27]** Signature Creation: https://sdk.invoicing.eta.gov.eg/signature-creation/
- **[S28]** Document validation rules (e-invoice equations): https://sdk.invoicing.eta.gov.eg/document-validation-rules/
- **[S29]** Login as Taxpayer System: https://sdk.invoicing.eta.gov.eg/api/01-login-as-taxpayer-system/
- **[S30]** ETA e-Receipt FAQ, 24th edition, 31 Jan 2024 (Arabic PDF): https://eta.gov.eg/sites/default/files/2024-02/ERECEIPT-FAQ-V24-31-1-2024.pdf
- **[S31]** ETA e-receipt services page (guides, POS registration site, vendor list): https://eta.gov.eg/ar/content/e-receipt-services
- **[S32]** ETA news, 26 May 2022, e-receipt phase timetable: https://eta.gov.eg/ar/news/alzam-400-mmwl-wmklf-bmhafzat-alqahrt-alkbry-walaskndryt-balaysalat-alalktrwnyt-awl-aktwbr
- **[S33]** ETA news, 18 May 2025, VAT on restaurants and cafes: https://www.eta.gov.eg/ar/news/twdh-khdw-almtam-walkafyhat-almhddt-bqrarat-wzyr-almalyt-ldrybt-alqymt-almdaft
- **[S34]** ETA POS technical requirements v3.2: https://eta.gov.eg/sites/default/files/2023-02/POS-requirements_v3.2.pdf
- **[S35]** ETA Taxpayers Readiness Guide Part 2 (e-seal and ITIDA): https://eta.gov.eg/sites/default/files/2023-01/Taxpayers-Readiness-Guide-Second%20Part-2023.pdf

Secondary sources (laws hosted on non-official sites, news); treat as UNCONFIRMED until checked against the Official Gazette:

- **[S36]** Law 206/2020 (Unified Tax Procedures Law), consolidated text: https://alberonsy.com/?p=3926
- **[S37]** Executive Regulations, MoF Decree 286/2021: https://lawhub.info/eg/?p=12788
- **[S38]** Youm7, 14 Aug 2020, 12% fee on parties under Law 83/2020: https://www.youm7.com/story/2020/8/14/%D8%A7%D9%84%D8%B3%D9%8A%D8%A7%D8%AD%D8%A9-%D8%AA%D8%A8%D9%84%D8%BA-%D8%A7%D9%84%D9%85%D9%86%D8%B4%D8%A2%D8%AA-%D8%A8%D9%82%D8%B1%D8%A7%D8%B1-%D8%AA%D8%AE%D8%B5%D9%8A%D8%B5-12-%D9%85%D9%86-%D9%82%D9%8A%D9%85%D8%A9-%D8%A7%D9%84%D8%AD%D9%81%D9%84%D8%A7%D8%AA-%D9%84%D8%AA%D9%86%D9%85%D9%8A%D8%A9/4928231
- **[S39]** Shorouk, 17 Jul 2023, Chamber of Tourist Establishments (12% service + 14% VAT): https://www.shorouknews.com/news/view.aspx?cdate=17072023&id=1296674a-7dfc-4118-b9c0-7e07085da233
- **[S40]** Vetogate, Labour Decree 177/2024 on distributing service-charge proceeds: https://www.vetogate.com/5213110
- **[S41]** ETA and press items on later phase decisions:
  - Decision 302/2024 (main phase 5): https://www.incometax.gov.eg/ar/news/sdwr-qrar-rqm-302-lsnt-2024-alkhas-balmrhlt-alryysyt-alkhamst-lmnzwmt-alaysal-alalktrwny
  - Phase 6.2 / Decision 455/2024 (Al-Dostor): https://www.dostor.org/4919069
  - ETA node on phase 4.5: https://eta.gov.eg/en/node/796

Note: the SDK pages were read through a summarising fetcher, and the PDFs were read directly. Re-read the SDK pages for exact byte-level details before coding, especially §1.5, and validate everything end-to-end in preprod.
