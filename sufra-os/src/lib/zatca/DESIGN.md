# ZATCA (FATOORA) Phase 2 e-invoicing: design, sources, status

Wave 3 of Sufra OS: Saudi outlets issue ZATCA documents (UBL 2.1 XML, UUID, ICV, PIH hash chain, ECDSA secp256k1 stamp,
TLV QR) from the POS. Egyptian outlets keep issuing ETA e-receipts.

> **Nothing here is "certified".** Real compliance needs each EGS unit to pass ZATCA's compliance checks
> (`/compliance/invoices`) in the sandbox/simulation environment, using an OTP that the owner generates in the Fatoora
> portal, followed by a production CSID. Until then Sufra builds, stamps, chains and queues documents, and nothing has
> been validated by ZATCA. The items marked **UNCONFIRMED** below need to be checked with the official SDK
> (`fatoora -validate`) or the sandbox before going live.

## Where things are

| Piece | File |
| --- | --- |
| Bytes / Base64 / PEM | `bytes.ts` |
| QR TLV encode/decode | `tlv.ts` |
| XML tree, Canonical XML 1.1 serialiser, parser, "detached" subtree serialiser | `xml.ts` |
| DER writer/reader | `asn1.ts` |
| secp256k1 keys, ECDSA, SPKI/SEC1, PKCS#10 CSR, X.509 reading, demo certificate | `crypto.ts` (`@noble/curves`, `@noble/hashes`) |
| UBL 2.1 invoice tree, document totals, invoice hash, `FIRST_PIH` | `ubl.ts` |
| XAdES stamp + Phase-2 QR, server-side stamping of offline docs, verification | `sign.ts` |
| ICV/PIH chain | `chain.ts` |
| Pre-flight BR-KSA checks | `validate.ts` |
| API request builders and response parsing (shared with `/api`) | `api.ts`, test fixtures `fixtures.ts` |
| Compliance sample documents (6 types) | `samples.ts` |
| Rows/settings types | `model.ts`, `types.ts` (pure input model) |
| Settings defaults, KSA tax settings, country switch, readiness | `settings.ts` |
| POS issuing (bill → document, EGS unit, demo key) | `issue.ts`, receipt bridge `receipt.ts` |
| Browser → server calls | `client.ts` |
| KSA demo tenant | `demoSeed.ts` |
| Server functions | `/api/zatca-onboard.ts`, `/api/zatca-report.ts`, `/api/zatca-clear.ts`, `/api/_lib/zatca-server.ts` |
| UI | `src/modules/settings/zatca/` (Settings → ZATCA, `/pos/zatca` queue, B2B buyer dialog) |
| Schema | `supabase/migrations/0014_zatca.sql` (+ `supabase/tests/zatca_run.sh`) |
| Finance | `sufra-finance/src/tax.ts`: `KSA_PROFILE`, `documentVat` (+ `ksa.test.ts`) |

The files `bytes, tlv, xml, asn1, crypto, ubl, sign, chain, validate, api, samples, types` do not use `@/` aliases,
because the Vercel functions import them directly.

## Flow

1. **Country switch** (`taxRegime`): when `restaurant.country === "SA"` and `settings.zatca.enabled`, `issueDocument`
   (POS `sale.ts`) builds a ZATCA document. ETA is skipped and the receipt gets `etaStatus: not_required`. Egypt is
   unchanged.
2. **Issue** (`issue.ts`): the bill (`@finance/tax` with `KSA_PROFILE`: VAT 15% inclusive, no service charge, halalas)
   becomes lines with net and VAT in halalas. The delivery fee becomes its own line. The document VAT is computed on the
   taxable total, and the difference to the amount paid goes to `PayableRoundingAmount`. The chain comes from the last
   document of the device's EGS unit, and every document gets a UUID.
   - Simplified (B2C) invoice by default. A **B2B buyer** on the check (POS "B2B" button: VAT number + national
     address) makes it a **standard** invoice.
   - A return becomes a **credit note** (381) of the same kind as the sale. It carries `BillingReference` = the original
     invoice number and `InstructionNote` = the refund reason.
3. **Stamp**:
   - `keyCustody: "server"` (production): the tablet has no key. The document is stored `unsigned` and the receipt
     prints a Phase-1 QR (tags 1–5) marked "provisional". `/api/zatca-report` stamps it with the Vault key. The hashed
     content does not change, so the hash and every later PIH stay valid. Then it is reported.
   - `keyCustody: "demo_browser"`: a key and a self-signed "SUFRA-DEMO-CA" certificate live in this tablet's
     localStorage. Documents are stamped at issue and get a full 9-tag QR, but they are marked **demo** on the receipt
     and in the queue, and the server refuses demo units.
   - Standard documents are sent to clearance unsigned. ZATCA stamps them and returns the cleared XML with its own QR;
     we store `clearedXml` and the QR.
4. **Submit**: `/api/zatca-report` runs on demand (queue "Report") and from Vercel Cron (`Authorization: Bearer
   $CRON_SECRET`). It handles simplified documents due within 24 h, with back-off of 1, 2, 4 … 60 min.
   `/api/zatca-clear` handles standard documents synchronously. On 303 (clearance switched off) it stamps the document
   and reports it.
5. **Queue** (`/pos/zatca`): shows pending, awaiting stamp, reported, cleared, warnings, rejected and demo documents,
   with 24 h triage (ok, soon < 8 h, urgent < 2 h, overdue). It offers retry, XML view, QR decode (tags 1–9) and local
   re-verification (hash, signature, SignedProperties, certificate digest, QR consistency). It also detects a broken chain.
6. **Onboarding** (Settings → ZATCA): seller data in the national-address format, environment, invoice types (TSCZ
   `1100`/`0100`), key custody, KSA tax profile button and a readiness checklist. EGS units go through the wizard: server
   CSR → OTP → compliance CSID → compliance checks (6 samples) → production CSID, showing CSID expiry. Demo units can show
   their CSR and run a **local** dry run of the 6 samples (our checks, not ZATCA's). The page also has an Arabic guide.

## Environment (server)

| Var | Meaning |
| --- | --- |
| `ZATCA_ENV` | `sandbox` (Developer Portal) · `simulation` · `production`. If unset, every `/api/zatca-*` answers **501** `{error:"not_configured", missing:[…]}` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | rows + Vault (`zatca_egs_secret` / `zatca_store_egs_secret`, service_role only) |
| `CRON_SECRET` | lets Vercel Cron call `/api/zatca-report` |

Each unit has one Vault secret, `zatca:egs:<unit id>` = `{"privateKeyPem","compliance":{"token","secret"},"production":{…}}`.
The private key is generated by `/api/zatca-onboard` (`action: "csr"`) and never leaves the server.

## Specification points and sources

Official ZATCA documents (downloaded 2026-11-03):
- **[XML]** *E-Invoicing XML Implementation Standard* v1.2 (2023-05-19):
  https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf
- **[SEC]** *Electronic Invoice Security Features Implementation Standards* v1.2 (2023-05-19):
  https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf
- **[DEV]** *Developer Portal Manual* v3 (Nov 2022): https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/DEVELOPER-PORTAL-MANUAL.pdf
- Secondary: withone.ai ZATCA API knowledge pages (compliance endpoint shape), ZATCA developer community forum
  (zatca1.discourse.group) threads on hash mismatches, and the catalogue §11 (`docs/sufra-os-feature-catalogue.md`).

| Point | What we do | Source / status |
| --- | --- | --- |
| Type codes 388/381/383, `name` 0100000 standard / 0200000 simplified | `TYPE_CODE`, `subtypeName` | [XML] §11.2.1. **Confirmed** |
| Root element `Invoice` for notes too | yes | [XML] §11.2.1 says "UBL Message type is Invoice for all document types", but the table lists "Credit note" for 381. SDK samples use `Invoice`. **Confirmed (text), table contradicts** |
| `ProfileID` = `reporting:1.0` | yes | [XML] BR-KSA-EN16931-01. **Confirmed** |
| `TaxCurrencyCode` SAR, 2 `TaxTotal` (one with subtotals, one without) | yes | BR-KSA-68, EN16931-02/08/09. **Confirmed** |
| UUID, IssueTime `hh:mm:ss` (AST) | UUID v4, Riyadh wall time | BR-KSA-03, BR-KSA-70. **Confirmed** |
| ICV in `AdditionalDocumentReference[ID=ICV]/UUID`, digits only | yes | BR-KSA-33/34. **Confirmed** |
| PIH in `ADR[ID=PIH]/Attachment/EmbeddedDocumentBinaryObject`; first = `NWZlY2ViNjZm…NTdlOQ==` | `FIRST_PIH` = Base64(hex(SHA-256("0"))) (golden test) | BR-KSA-26/61. **Confirmed** |
| Invoice hash: drop UBLExtensions, QR ADR and cac:Signature, C14N 1.1, SHA-256, Base64 | `stripForHash` + `canonical` | BR-KSA-26 steps 1–6, [SEC] §2.3.3 transforms. **Confirmed** (rule). Byte-equality with the SDK is **UNCONFIRMED**: forum threads report SDK-version-dependent whitespace handling. We emit no inter-element whitespace, so the removal leaves nothing behind. |
| Seller address: street, building (4 digits), district, city, postal (5 digits), country | `checkAddress` | BR-KSA-09/37/66. **Confirmed** |
| Seller ID with schemeID CRN/MOM/MLS/700/SAG/OTH | `seller.id` | BR-KSA-08. **Confirmed** |
| Standard: buyer name, VAT number or other ID, address; `ActualDeliveryDate` | `checkInvoice`, `Delivery` | BR-KSA-10/14/15/42/63/67. **Confirmed** |
| Notes: `BillingReference` and `InstructionNote` reason | yes | BR-KSA-56, BR-KSA-17. **Confirmed** |
| Line `TaxTotal`: TaxAmount (KSA-11) + RoundingAmount (KSA-12 = net + VAT) | yes | BR-KSA-51/52/53, DEC-03/04. **Confirmed** |
| Document VAT = round(taxable × rate), half-up, not the sum of line VATs | `computeTotals`, finance `documentVat` | [XML] §9.6, §10, BR-CO-17. **Confirmed** |
| Exempt/out-of-scope lines need a reason code | `VATEX-SA-OOS` for `vatExempt` items | BR-KSA-CL-04/83. Rule **confirmed**; choosing OOS for restaurant "exempt" items is our **assumption** (the accountant decides) |
| Item price when net/qty is not whole halalas | `PriceAmount` = line net with `BaseQuantity` = qty | UBL-legal. **UNCONFIRMED** against the validator's BR-KSA-EN16931-07 |
| Discounts | folded into the net price (no AllowanceCharge) | Simplification. **UNCONFIRMED** whether ZATCA expects an explicit allowance |
| Stamp structure (XAdES B-B; SignedInfo with 2 References, 4 transforms, c14n11, ecdsa-sha256; KeyInfo X509Certificate; SignedProperties: SigningTime, SigningCertificate(CertDigest, IssuerSerial)) | `sign.ts` | [SEC] §2.3.3. **Confirmed** (structure) |
| `ds:Reference/@Type` of SignedProperties | `http://www.w3.org/2000/09/xmldsig#SignatureProperties` (what the SDK emits) | [SEC] text says `http://uri.etsi.org/01903#SignedProperties`. **UNCONFIRMED; the two disagree** |
| Signature value = ECDSA(SHA-256) over the invoice-hash bytes (not over SignedInfo) | `signDer(hashBytes)` | SDK behaviour reproduced by community libraries. **UNCONFIRMED** in official text |
| CertDigest = Base64(hex(SHA-256(Base64 certificate text))) | `sha256HexB64(utf8(certB64))` | SDK behaviour. **UNCONFIRMED** |
| SignedProperties digest = Base64(hex(SHA-256(subtree serialised with only the namespaces it uses))) | `detached()` | SDK (Java DOM) behaviour. **UNCONFIRMED. This is the first thing to verify with `fatoora -validate`** |
| X509IssuerName format `CN=…, DC=…` (most specific first) | `dn()` | **UNCONFIRMED** |
| Curve secp256k1, SHA-256, ECDSA 256 | `@noble/curves` secp256k1 | [SEC] §2 item 16 (ECDSA, 256, SHA-256). The curve name comes from the SDK `csr-config` / catalogue §11. **Confirmed (SDK)** |
| CSR: subject C=SA, OU=branch, O=taxpayer, CN; SAN dirName SN=`1-…\|2-…\|3-…`, UID=VAT, title=TSCZ, registeredAddress, businessCategory; extension 1.3.6.1.4.1.311.20.2 = `TSTZATCA-`/`PREZATCA-`/`ZATCA-Code-Signing` | `buildCsr` (node verifies its self-signature in tests) | [SEC] Table 1 lists the fields and OIDs. Table 1 names the VAT field `organizationIdentifier (2.5.4.97)`, but the SDK config puts it in SAN `UID`; we follow the SDK. Template names: secondary sources. **Partly UNCONFIRMED** |
| `/compliance` body `{"csr": Base64(PEM)}` | yes | SDK output; withone.ai lists the field as required without naming it. **UNCONFIRMED** |
| QR: TLV, 1-byte tag, 1-byte length, UTF-8 values, Base64, ≤ 700 chars; tags 1–9, tag 9 simplified only | `tlv.ts`, `buildQr` | [SEC] §4, Table 3. **Confirmed**. Golden test: the widely published phase-1 example. |
| QR tag 6/7 encoding | Base64 text of the hash / DER signature (UTF-8) | [SEC] says tag 6 "length of hash is 32 bytes" (raw), but the SDK writes the Base64 text. We follow the SDK. **UNCONFIRMED** |
| QR tag 8 / 9 | raw DER SubjectPublicKeyInfo / raw DER CA signature of the certificate | [SEC] Table 3. Encoding per SDK. **UNCONFIRMED** |
| QR tag 3 timestamp | `${IssueDate}T${IssueTime}` (no zone, like the SDK) | [SEC] example uses `…Z`. **UNCONFIRMED** |
| API base `https://gw-fatoora.zatca.gov.sa/e-invoicing/{developer-portal\|simulation\|core}` | `ZATCA_BASE` | withone.ai + community guides. **UNCONFIRMED (secondary)** |
| `Accept-Version: V2` on every call | yes | [DEV] §2.3.10 ("V2 is currently the only valid version"). **Confirmed** |
| Endpoints: POST `/compliance` (OTP header), POST `/compliance/invoices`, POST/PATCH `/production/csids`, POST `/invoices/reporting/single`, POST `/invoices/clearance/single` | `api.ts` | [DEV] names reporting/single and clearance/single; the others come from secondary sources. **Partly confirmed** |
| Body `{invoiceHash, uuid, invoice(Base64 XML)}` | yes | [DEV] FAQ (hash + invoice) and the sandbox steps "(invoice hash, UUID, encoded XML)". **Confirmed** |
| Auth: Basic `binarySecurityToken:secret` | yes | [SEC] §5 (OAuth2 Basic, client ID = certificate, secret issued at onboarding) and [DEV] ("binarySecurityToken as Username, secret as Password"). **Confirmed** |
| `Clearance-Status` header 0/1 | yes | Secondary. **UNCONFIRMED** |
| Status codes 200 / 202 (warnings) / 303 (clearance off → reporting) / 400 / 500 | `parseSubmitResponse` (+ 401/403 creds, 409 duplicate, 429/5xx retry) | [DEV] FAQ items 9–10. **Confirmed** for 200/202/303/400/500; our 401/409/429 handling is an assumption |
| Response JSON `validationResults{info,warning,errorMessages,status}`, `reportingStatus`, `clearanceStatus`, `clearedInvoice` | parser + `fixtures.ts` | Sandbox Swagger shape (secondary). The fixtures are representative, **not recorded live** |
| Simplified docs reported within 24 h; standard docs cleared before hand-over | queue triage, clearance before printing | Catalogue §11 / E-invoicing resolution. **Confirmed** |
| Seller name in Arabic | `checkSeller` (`VAT-IR-53`) | VAT Implementing Regulations art. 53. **Confirmed (regulation)** |
| Wave 24 deadline 30 Jun 2026 | shown in the guide | Catalogue §11 |

## Canonicalizer limits (`xml.ts`)

The canonicalizer handles the documents Sufra writes: elements, attributes, text, namespace declarations on elements,
the five predefined entities and numeric references. It drops comments and the XML declaration and orders attributes
per C14N. It does not handle DTDs or entity declarations, CDATA, PIs other than the declaration, `xml:*` attribute
inheritance (a C14N 1.1 detail), namespace undeclaration (`xmlns=""`), or non-ASCII names. Parsing XML from elsewhere
(cleared invoices) works for ZATCA's own output, which uses the same subset. If ZATCA returns something richer, verification
reports an error instead of silently mis-hashing.

## Money

`KSA_PROFILE` (sufra-finance) sets VAT 15% inclusive, no service charge, `taxDecimals: 2` (halalas). Line VAT is rounded
per line, so `net + VAT = printed` for every line. The e-invoice declares document-level VAT, which can differ from the
sum of line VATs by a halala; `PayableRoundingAmount` absorbs that so the payable equals what the guest paid. The ledger
(`postSale`) still posts the line-sum VAT. **To do (accounting):** post the per-invoice difference (`totals.vat − bill.vat`)
to rounding so the VAT return matches the declared invoices exactly.

## Tests

- `zatca.test.ts` covers TLV (golden phase-1 sample), `FIRST_PIH` golden, the PIH/ICV chain, a hash stable across runs
  that equals node:crypto's SHA-256 of our C14N, a signature verified by node:crypto with our SPKI, node parsing and
  verifying the demo certificate, a node-verified CSR, SEC1 PEM accepted by node as secp256k1, QR tags 1–9 contents,
  standard docs unsigned, 15% document VAT and rounding, credit-note references, well-formed XML with required fields,
  pre-flight rules, and server stamping being byte-identical to signing at issue.
- `pos.test.ts` runs the KSA POS end to end on the local backend: sale, chain, credit note, B2B standard invoice, and
  Egypt still issuing ETA.
- `server.test.ts` covers request building, response parsing (fixtures), 501 when not configured, onboarding against a
  fake ZATCA that recomputes hashes and verifies signatures, reporting of an offline document after server stamping,
  clearance, and refusing demo units.
- `sufra-finance/src/ksa.test.ts` covers the KSA profile (15% inclusive in halalas, document vs line VAT, delivery).
- `supabase/tests/zatca_run.sh` covers the chain trigger (first PIH, gaps, wrong PIH), immutability, and server stamping
  allowed once.

## Not done / next

- Validate against the official SDK (`fatoora -validate -invoice …`) and the sandbox compliance API, using the owner's
  OTP. Fix whatever the UNCONFIRMED rows turn out to be.
- PDF/A-3 with embedded XML for archiving, and a buyer-facing A4 standard invoice from the cleared XML.
- Debit notes from the POS (the builder supports 383; there is no UI flow yet).
- CSID renewal reminders (expiry is shown) and revocation handling.
- Posting the VAT rounding difference in accounting (see Money).
- Per-branch seller/address overrides (one VAT registrant per restaurant today).
