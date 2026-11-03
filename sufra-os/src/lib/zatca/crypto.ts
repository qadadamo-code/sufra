/**
 * EGS cryptography — ECDSA over secp256k1 with SHA-256 (Security Features Implementation Standards §2: "Asymmetric key
 * algorithm shall be ECDSA; key length 256; hashing SHA-256"; the ZATCA SDK and CSR config use the secp256k1 curve).
 * WebCrypto has no secp256k1, so this uses @noble/curves + @noble/hashes (audited, zero-dependency, pure TS).
 *
 * Key custody: in production the EGS private key is generated and kept SERVER-SIDE (api/zatca-onboard.ts → Supabase
 * Vault); the browser only ever sees the public key and certificates. `keyMode: "demo_browser"` keeps a key in the
 * tablet's localStorage for the offline demo — clearly flagged in the UI, never accepted by the server functions.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bits, bitString, ctx, generalizedTime, int, intValue, octets, oid, oidString, parseDer, printable, seq, set, utcTime, utf8Str, type Der } from "./asn1";
import { concat, fromBase64, fromPem, toBase64, toHex, toPem, utf8 } from "./bytes";

export const sha256 = (b: Uint8Array): Uint8Array => nobleSha256(b);
export const sha256B64 = (b: Uint8Array) => toBase64(sha256(b));
/** ZATCA quirk: some digests are Base64 of the lowercase HEX of the SHA-256 (first PIH, cert + SignedProperties digests). */
export const sha256HexB64 = (b: Uint8Array) => toBase64(utf8(toHex(sha256(b))));

export const OID = {
  ecPublicKey: "1.2.840.10045.2.1",
  secp256k1: "1.3.132.0.10",
  ecdsaWithSHA256: "1.2.840.10045.4.3.2",
  extensionRequest: "1.2.840.113549.1.9.14",
  subjectAltName: "2.5.29.17",
  /** Microsoft "certificate template name" — ZATCA-Code-Signing / PREZATCA-Code-Signing / TSTZATCA-Code-Signing */
  certTemplateName: "1.3.6.1.4.1.311.20.2",
  basicConstraints: "2.5.29.19",
  C: "2.5.4.6",
  O: "2.5.4.10",
  OU: "2.5.4.11",
  CN: "2.5.4.3",
  SN: "2.5.4.4",
  title: "2.5.4.12",
  registeredAddress: "2.5.4.26",
  businessCategory: "2.5.4.15",
  UID: "0.9.2342.19200300.100.1.1",
  DC: "0.9.2342.19200300.100.1.25",
  organizationIdentifier: "2.5.4.97",
  E: "1.2.840.113549.1.9.1",
} as const;

const SHORT: Record<string, string> = Object.fromEntries(Object.entries(OID).map(([k, v]) => [v, k]));

/* ───────── keys ───────── */

export interface EgsKeyPair {
  /** 32-byte secret scalar */
  secretKey: Uint8Array;
  /** 65-byte uncompressed point (04‖X‖Y) */
  publicKey: Uint8Array;
}

export function generateKeyPair(): EgsKeyPair {
  const secretKey = secp256k1.utils.randomSecretKey();
  return { secretKey, publicKey: secp256k1.getPublicKey(secretKey, false) };
}
export const keyPairFromSecret = (secretKey: Uint8Array): EgsKeyPair => ({ secretKey, publicKey: secp256k1.getPublicKey(secretKey, false) });

const algEc = () => seq(oid(OID.ecPublicKey), oid(OID.secp256k1));
/** SubjectPublicKeyInfo DER — what QR tag 8 carries (raw bytes) */
export const spkiDer = (publicKey: Uint8Array) => seq(algEc(), bitString(publicKey));
export function publicKeyFromSpki(der: Uint8Array): Uint8Array {
  const d = parseDer(der);
  if (oidString(d.children[0].children[1]) !== OID.secp256k1) throw new Error("not a secp256k1 key");
  return bits(d.children[1]);
}

/** SEC1 ECPrivateKey ("-----BEGIN EC PRIVATE KEY-----", what `openssl ecparam -name secp256k1 -genkey` writes). */
export const sec1Pem = (k: EgsKeyPair) => toPem("EC PRIVATE KEY", seq(int(1), octets(k.secretKey), ctx(0, oid(OID.secp256k1)), ctx(1, bitString(k.publicKey))));
export function keyPairFromPem(pem: string): EgsKeyPair {
  const { der } = fromPem(pem);
  const d = parseDer(der);
  // SEC1: SEQ { 1, OCTET STRING key, ... } · PKCS#8: SEQ { 0, AlgId, OCTET STRING { SEC1 } }
  if (d.children[1]?.tag === 0x04) return keyPairFromSecret(d.children[1].body);
  if (d.children[2]?.tag === 0x04) return keyPairFromPem(toBase64(d.children[2].body));
  throw new Error("unsupported private key format");
}

/* ───────── signatures ───────── */

/** ECDSA-SHA256 over `message` (sha256 applied inside), DER-encoded signature. */
export const signDer = (message: Uint8Array, secretKey: Uint8Array) => secp256k1.sign(message, secretKey, { format: "der" });
export function verifyDer(sigDer: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return secp256k1.verify(sigDer, message, publicKey, { format: "der", lowS: false });
  } catch {
    return false;
  }
}

/* ───────── X.500 names ───────── */

export type Rdn = [oid: string, value: string, kind?: "utf8" | "printable"];
const atv = ([o, v, kind]: Rdn) => seq(oid(o), kind === "printable" || o === OID.C ? printable(v) : utf8Str(v));
/** One attribute per RDN, in the given order (most significant first, e.g. C, OU, O, CN). */
export const name = (rdns: Rdn[]) => seq(...rdns.map((r) => set(atv(r))));

/* ───────── CSR (PKCS#10) ───────── */

export type ZatcaEnv = "sandbox" | "simulation" | "production";
/** Certificate template per environment (ZATCA SDK csr-config: TSTZATCA- / PREZATCA- / ZATCA-Code-Signing). */
export const CSR_TEMPLATE: Record<ZatcaEnv, string> = { sandbox: "TSTZATCA-Code-Signing", simulation: "PREZATCA-Code-Signing", production: "ZATCA-Code-Signing" };

export interface CsrInput {
  env: ZatcaEnv;
  /** CN — EGS unit name, e.g. "Sufra-POS1-RUH" */
  commonName: string;
  /** "1-<solution/manufacturer>|2-<model/version>|3-<serial>" */
  egsSerial: string;
  /** 15 digits, begins and ends with 3 */
  vatNumber: string;
  /** branch name (OU); for VAT groups the 10-digit TIN of the member */
  orgUnit: string;
  /** taxpayer name (O) */
  orgName: string;
  /** "TSCZ" flags: "1100" = standard + simplified, "0100" = simplified only */
  invoiceTypes: string;
  /** short national address of the branch */
  location: string;
  industry: string;
}

export function buildCsr(k: EgsKeyPair, x: CsrInput): { der: Uint8Array; pem: string; base64Pem: string } {
  const subject = name([[OID.C, "SA"], [OID.OU, x.orgUnit], [OID.O, x.orgName], [OID.CN, x.commonName]]);
  const dirName = name([[OID.SN, x.egsSerial], [OID.UID, x.vatNumber], [OID.title, x.invoiceTypes], [OID.registeredAddress, x.location], [OID.businessCategory, x.industry]]);
  const san = seq(ctx(4, dirName)); // GeneralNames { directoryName [4] }
  const exts = seq(
    seq(oid(OID.certTemplateName), octets(printable(CSR_TEMPLATE[x.env]))),
    seq(oid(OID.subjectAltName), octets(san)),
  );
  const attributes = ctx(0, seq(oid(OID.extensionRequest), set(exts)));
  const info = seq(int(0), subject, spkiDer(k.publicKey), attributes);
  const sig = signDer(info, k.secretKey);
  const der = seq(info, seq(oid(OID.ecdsaWithSHA256)), bitString(sig));
  const pem = toPem("CERTIFICATE REQUEST", der);
  // ZATCA's /compliance takes {"csr": base64(PEM text)} (SDK `fatoora -csr` output) — see DESIGN.md
  return { der, pem, base64Pem: toBase64(utf8(pem)) };
}

/* ───────── X.509 (read ZATCA CSIDs; demo self-signed) ───────── */

export interface CertInfo {
  /** Base64 DER, exactly as it goes into ds:X509Certificate */
  base64: string;
  serial: bigint;
  /** issuer DN as ZATCA expects it in ds:X509IssuerName (most specific first, ", " separated) */
  issuerName: string;
  subjectName: string;
  notBefore: Date;
  notAfter: Date;
  publicKey: Uint8Array;
  /** DER ECDSA signature of the issuing CA over the certificate — QR tag 9 */
  signature: Uint8Array;
}

function dn(d: Der): string {
  const parts = d.children.flatMap((rdn) => rdn.children.map((a) => `${SHORT[oidString(a.children[0])] ?? oidString(a.children[0])}=${new TextDecoder().decode(a.children[1].body)}`));
  return parts.reverse().join(", ");
}
function time(d: Der): Date {
  const s = new TextDecoder().decode(d.body);
  const full = d.tag === 0x17 ? (Number(s.slice(0, 2)) >= 50 ? "19" : "20") + s : s;
  return new Date(`${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}T${full.slice(8, 10)}:${full.slice(10, 12)}:${full.slice(12, 14)}Z`);
}

/** Accepts PEM, Base64 DER, or ZATCA's binarySecurityToken (Base64 of the Base64 DER). */
export function parseCertificate(input: string): CertInfo {
  let der = fromPem(input.trim()).der;
  if (der[0] !== 0x30) der = fromBase64(new TextDecoder().decode(der)); // binarySecurityToken is double-encoded
  const c = parseDer(der);
  const tbs = c.children[0];
  const hasVersion = tbs.children[0].tag === 0xa0;
  const f = tbs.children.slice(hasVersion ? 1 : 0);
  const [serial, , issuer, validity, subject, spki] = f;
  return {
    base64: toBase64(der),
    serial: intValue(serial),
    issuerName: dn(issuer),
    subjectName: dn(subject),
    notBefore: time(validity.children[0]),
    notAfter: time(validity.children[1]),
    publicKey: bits(spki.children[1]),
    signature: bits(c.children[2]),
  };
}

/**
 * DEMO ONLY: a self-signed certificate for a browser-held EGS key, so the demo can produce a structurally complete
 * signed invoice + QR (tags 8/9) before any CSID exists. It is NOT a ZATCA CSID and ZATCA will reject it.
 */
export function demoSelfSignedCertificate(k: EgsKeyPair, x: { commonName: string; vatNumber: string; serial?: bigint; now?: Date }): string {
  return issueCertificate(k.publicKey, k, x);
}

/** Certificate for `subjectPublicKey` signed by `ca` — the demo CA above, and test doubles of ZATCA's CA. */
export function issueCertificate(subjectPublicKey: Uint8Array, ca: EgsKeyPair, x: { commonName: string; vatNumber: string; serial?: bigint; now?: Date; issuerCn?: string }): string {
  const k = { publicKey: subjectPublicKey, secretKey: ca.secretKey };
  const now = x.now ?? new Date();
  const issuer = name([[OID.C, "SA"], [OID.O, "Sufra OS DEMO (not ZATCA)"], [OID.CN, x.issuerCn ?? "SUFRA-DEMO-CA"]]);
  const subject = name([[OID.C, "SA"], [OID.O, "DEMO"], [OID.CN, x.commonName]]);
  const notAfter = new Date(now.getTime() + 365 * 86_400_000);
  const tbs = seq(
    ctx(0, int(2)),
    int(x.serial ?? BigInt("0x" + toHex(sha256(concat(k.publicKey, utf8(x.vatNumber)))).slice(0, 16))),
    seq(oid(OID.ecdsaWithSHA256)),
    issuer,
    seq(utcTime(now), notAfter.getUTCFullYear() < 2050 ? utcTime(notAfter) : generalizedTime(notAfter)),
    subject,
    spkiDer(k.publicKey),
  );
  const der = seq(tbs, seq(oid(OID.ecdsaWithSHA256)), bitString(signDer(tbs, k.secretKey)));
  return toBase64(der);
}
