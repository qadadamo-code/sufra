/**
 * A deliberately small XML toolkit for the documents Sufra generates (UBL 2.1 invoices + their XAdES signature):
 *
 *  - `el()` builds an element tree; `canonical()` serialises it in **Canonical XML 1.1** form (W3C REC xml-c14n11):
 *    no XML declaration, no comments, start/end tag pairs (never `<a/>`), namespace declarations first (sorted), then
 *    attributes sorted by (namespace URI, local name), C14N text/attribute escaping, no redundant namespace declarations.
 *    Because Sufra *writes* every invoice in this form (plus the XML declaration), the stored XML, the hashed bytes and
 *    what ZATCA recomputes all come from one serialiser.
 *  - `parseXml()` reads XML back (stored invoices, cleared invoices returned by ZATCA) into the same tree.
 *
 * Limits (documented in DESIGN.md): no DTDs/entities beyond the five predefined + numeric references, no CDATA, no
 * processing instructions other than the XML declaration, no `xml:*` attribute inheritance, no namespace undeclaration
 * (`xmlns=""`). Whitespace text nodes are kept exactly (C14N keeps them); Sufra emits no whitespace between elements, so
 * removing UBLExtensions / Signature / QR for the invoice hash never leaves stray newlines behind.
 */

export type XNode = XElement | string;
export interface XElement {
  name: string;
  /** in document order; namespace declarations are ordinary attributes named `xmlns` / `xmlns:p` */
  attrs: [string, string][];
  children: XNode[];
}

type Child = XNode | null | undefined | false | Child[];

/** `el("cbc:ID", { schemeID: "CRN" }, "1010")` — null/undefined attributes and children are skipped. */
export function el(name: string, attrs?: Record<string, string | number | null | undefined> | null, ...children: Child[]): XElement {
  const a: [string, string][] = [];
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== null && v !== undefined) a.push([k, String(v)]);
  const kids: XNode[] = [];
  const push = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(push);
    else kids.push(c);
  };
  children.forEach(push);
  return { name, attrs: a, children: kids };
}

export const isEl = (n: XNode): n is XElement => typeof n !== "string";

/* ───────── escaping (C14N §1.1/2.3) ───────── */

export const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
export const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");

const isNsDecl = (k: string) => k === "xmlns" || k.startsWith("xmlns:");
const prefixOf = (qname: string) => (qname.includes(":") ? qname.slice(0, qname.indexOf(":")) : "");
const localOf = (qname: string) => (qname.includes(":") ? qname.slice(qname.indexOf(":") + 1) : qname);

type Scope = Map<string, string>; // prefix ("" = default) → uri

function declsOf(e: XElement): [string, string][] {
  return e.attrs.filter(([k]) => isNsDecl(k)).map(([k, v]) => [k === "xmlns" ? "" : k.slice(6), v]);
}

function sortedAttrs(e: XElement, scope: Scope): [string, string][] {
  const plain = e.attrs.filter(([k]) => !isNsDecl(k));
  const uri = (k: string) => (prefixOf(k) ? (scope.get(prefixOf(k)) ?? "") : "");
  return [...plain].sort((a, b) => {
    const ua = uri(a[0]), ub = uri(b[0]);
    if (ua !== ub) return ua < ub ? -1 : 1;
    const la = localOf(a[0]), lb = localOf(b[0]);
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
}

function nsAttr(prefix: string, uri: string) {
  return prefix ? ` xmlns:${prefix}="${escAttr(uri)}"` : ` xmlns="${escAttr(uri)}"`;
}
const byPrefix = (a: [string, string], b: [string, string]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/**
 * Canonical XML 1.1 of `root` (inclusive). `inScope` = namespaces already declared by ancestors that are NOT part of the
 * output (document subset): per C14N they are rendered on the apex element. For a whole document pass nothing.
 */
export function canonical(root: XElement, inScope: Scope = new Map()): string {
  const out: string[] = [];
  const walk = (e: XElement, rendered: Scope, scope: Scope, apex: boolean) => {
    const local = new Map(scope);
    for (const [p, u] of declsOf(e)) local.set(p, u);
    // namespace axis: everything in scope that differs from what the nearest output ancestor rendered
    const emit: [string, string][] = [];
    const candidates = apex ? [...local.entries()] : declsOf(e).map(([p]) => [p, local.get(p)!] as [string, string]);
    for (const [p, u] of candidates) if (rendered.get(p) !== u && !(p === "" && u === "" && !rendered.has(""))) emit.push([p, u]);
    emit.sort(byPrefix);
    const nextRendered = new Map(rendered);
    for (const [p, u] of emit) nextRendered.set(p, u);
    out.push(`<${e.name}`);
    for (const [p, u] of emit) out.push(nsAttr(p, u));
    for (const [k, v] of sortedAttrs(e, local)) out.push(` ${k}="${escAttr(v)}"`);
    out.push(">");
    for (const c of e.children) {
      if (typeof c === "string") out.push(escText(c));
      else walk(c, nextRendered, local, false);
    }
    out.push(`</${e.name}>`);
  };
  walk(root, new Map(), inScope, inScope.size > 0);
  return out.join("");
}

/** The document as Sufra stores and sends it: XML declaration + canonical body. */
export const serializeDocument = (root: XElement) => `<?xml version="1.0" encoding="UTF-8"?>\n${canonical(root)}`;

/**
 * "Detached" serialisation of a subtree, the way the ZATCA SDK (Java DOM) serialises xades:SignedProperties before
 * hashing it: only the namespaces the subtree actually uses are declared, each on the first element (in document order
 * along each branch) that needs it. Sibling ds:* elements therefore each carry their own xmlns:ds. Otherwise C14N rules
 * (sorted attributes, escaping, explicit end tags). See DESIGN.md "SignedProperties digest" — UNCONFIRMED until the
 * SDK validator accepts our output.
 */
export function detached(root: XElement, ancestorScope: Scope): string {
  const out: string[] = [];
  const walk = (e: XElement, declared: Scope, scope: Scope) => {
    const local = new Map(scope);
    for (const [p, u] of declsOf(e)) local.set(p, u);
    const need = new Set<string>([prefixOf(e.name)]);
    for (const [k] of e.attrs) if (!isNsDecl(k) && prefixOf(k)) need.add(prefixOf(k));
    const emit: [string, string][] = [];
    for (const [p, u] of declsOf(e)) if (declared.get(p) !== u) emit.push([p, u]);
    for (const p of need) {
      const u = local.get(p);
      if (u !== undefined && declared.get(p) !== u && !emit.some(([q]) => q === p)) emit.push([p, u]);
    }
    emit.sort(byPrefix);
    const next = new Map(declared);
    for (const [p, u] of emit) next.set(p, u);
    out.push(`<${e.name}`);
    for (const [p, u] of emit) out.push(nsAttr(p, u));
    for (const [k, v] of sortedAttrs(e, local)) out.push(` ${k}="${escAttr(v)}"`);
    out.push(">");
    for (const c of e.children) {
      if (typeof c === "string") out.push(escText(c));
      else walk(c, next, local);
    }
    out.push(`</${e.name}>`);
  };
  walk(root, new Map(), ancestorScope);
  return out.join("");
}

/* ───────── tree helpers ───────── */

/** Path of elements from root to the first element matching `pred` (inclusive), or null. */
export function pathTo(root: XElement, pred: (e: XElement) => boolean): XElement[] | null {
  if (pred(root)) return [root];
  for (const c of root.children) {
    if (!isEl(c)) continue;
    const p = pathTo(c, pred);
    if (p) return [root, ...p];
  }
  return null;
}

export const find = (root: XElement, pred: (e: XElement) => boolean): XElement | null => pathTo(root, pred)?.at(-1) ?? null;
export function findAll(root: XElement, pred: (e: XElement) => boolean, acc: XElement[] = []): XElement[] {
  if (pred(root)) acc.push(root);
  for (const c of root.children) if (isEl(c)) findAll(c, pred, acc);
  return acc;
}
export const byName = (name: string) => (e: XElement) => e.name === name;
export const textOf = (e: XElement | null | undefined): string => (e ? e.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("") : "");
export const attr = (e: XElement | null | undefined, k: string) => e?.attrs.find(([n]) => n === k)?.[1] ?? null;
/** child elements with this name (direct children only) */
export const kids = (e: XElement, name: string) => e.children.filter((c): c is XElement => isEl(c) && c.name === name);

/** Namespace scope in effect at the last element of `path` (from the declarations along it). */
export function scopeAt(path: XElement[]): Scope {
  const s: Scope = new Map();
  for (const e of path) for (const [p, u] of declsOf(e)) s.set(p, u);
  return s;
}

/** Deep copy without the direct/indirect children matching `drop`. */
export function without(root: XElement, drop: (e: XElement) => boolean): XElement {
  return {
    name: root.name,
    attrs: root.attrs.map(([k, v]) => [k, v]),
    children: root.children.filter((c) => !(isEl(c) && drop(c))).map((c) => (isEl(c) ? without(c, drop) : c)),
  };
}

/* ───────── parser ───────── */

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescape(s: string) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e],
  );
}
/** attribute-value normalisation (XML 1.0 §3.3.3) for literal whitespace — escaped forms stay as written */
const normAttr = (raw: string) => unescape(raw.replace(/[\t\n\r]/g, " "));

export class XmlError extends Error {}

export function parseXml(src: string): XElement {
  let i = 0;
  const s = src.replace(/\r\n?/g, "\n"); // XML 1.0 §2.11 end-of-line handling
  const fail = (m: string): never => {
    throw new XmlError(`${m} at ${i}`);
  };
  const skipMisc = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith("<?", i)) {
        const j = s.indexOf("?>", i);
        if (j < 0) fail("unterminated declaration");
        i = j + 2;
      } else if (s.startsWith("<!--", i)) {
        const j = s.indexOf("-->", i);
        if (j < 0) fail("unterminated comment");
        i = j + 3;
      } else if (s.startsWith("<!", i)) fail("DTDs are not supported");
      else return;
    }
  };
  const name = () => {
    const m = /^[A-Za-z_][\w.\-:]*/.exec(s.slice(i, i + 200));
    if (!m) fail("expected a name");
    i += m![0].length;
    return m![0];
  };
  const element = (): XElement => {
    if (s[i] !== "<") fail("expected <");
    i++;
    const n = name();
    const attrs: [string, string][] = [];
    for (;;) {
      while (/\s/.test(s[i])) i++;
      if (s.startsWith("/>", i)) {
        i += 2;
        return { name: n, attrs, children: [] };
      }
      if (s[i] === ">") {
        i++;
        break;
      }
      const k = name();
      while (/\s/.test(s[i])) i++;
      if (s[i] !== "=") fail("expected =");
      i++;
      while (/\s/.test(s[i])) i++;
      const q = s[i];
      if (q !== '"' && q !== "'") fail("expected quote");
      const j = s.indexOf(q, i + 1);
      if (j < 0) fail("unterminated attribute");
      if (attrs.some(([a]) => a === k)) fail(`duplicate attribute ${k}`);
      attrs.push([k, normAttr(s.slice(i + 1, j))]);
      i = j + 1;
    }
    const children: XNode[] = [];
    let text = "";
    for (;;) {
      if (i >= s.length) fail(`unclosed <${n}>`);
      if (s.startsWith("</", i)) {
        if (text) children.push(unescape(text));
        i += 2;
        const close = name();
        if (close !== n) fail(`</${close}> does not close <${n}>`);
        while (/\s/.test(s[i])) i++;
        if (s[i] !== ">") fail("expected >");
        i++;
        return { name: n, attrs, children };
      }
      if (s.startsWith("<!--", i)) {
        const j = s.indexOf("-->", i);
        if (j < 0) fail("unterminated comment");
        i = j + 3;
        continue;
      }
      if (s.startsWith("<![CDATA[", i)) fail("CDATA is not supported");
      if (s[i] === "<") {
        if (text) children.push(unescape(text));
        text = "";
        children.push(element());
        continue;
      }
      const j = s.indexOf("<", i);
      text += s.slice(i, j < 0 ? s.length : j);
      i = j < 0 ? s.length : j;
    }
  };
  skipMisc();
  const root = element();
  skipMisc();
  if (i < s.length) fail("content after the root element");
  return root;
}
