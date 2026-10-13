/* Rules for files kept in a moved MRE Office room (MLS Info's rule books first).
 *
 * Pure: no database, no Next, no file store, so the page, the routes and the
 * tests all use the same rules. The file store itself is lib/office-blob.js.
 *
 * What a file must be, checked on the server every time:
 *   - a type the room allows: PDF (the bytes start with %PDF-) or, for Must
 *     Have Contacts (v96), a contact file (.vcf: UTF-8 text that starts with
 *     BEGIN:VCARD and holds END:VCARD). The bytes decide, never the file's
 *     name or what the browser said. A renamed web page is refused
 *   - no bigger than the room's cap (4 MB: under Vercel's 4.5 MB request limit,
 *     and every file MRE Office has is under 1.6 MB)
 */

export const PDF = "application/pdf";
export const VCARD = "text/vcard";

/* What each kind of file is called and how it is recognised. Only these two
   are ever stored or served. */
export const FILE_KINDS = {
  [PDF]:   { ext: "pdf", label: "PDF",  noun: "PDF", accept: "application/pdf,.pdf", serveAs: PDF },
  [VCARD]: { ext: "vcf", label: "VCF",  noun: "contact file (.vcf)", accept: ".vcf,.vcard,text/vcard,text/x-vcard", serveAs: "text/vcard; charset=utf-8" },
};
export const kindInfo = type => FILE_KINDS[type] || FILE_KINDS[PDF];

/** Do these bytes start the way every PDF starts? */
export function isPdfBytes(bytes) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 5) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
}

/** Is this a contact file? UTF-8 text (a byte-order mark allowed) that starts
    with BEGIN:VCARD and has an END:VCARD, with no NUL bytes. */
export function isVcardBytes(bytes) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length < 20) return false;
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return false; }
  if (text.includes("\u0000")) return false;
  const t = text.replace(/^\uFEFF/, "").replace(/^\s+/, "");
  return /^BEGIN:VCARD\r?\n/i.test(t) && /\r?\nEND:VCARD\s*$/i.test(t.trimEnd() + "\n");
}

/** Which allowed kind these bytes are, or null. */
export function kindOfBytes(files, bytes) {
  for (const type of files?.types || []) {
    if (type === PDF && isPdfBytes(bytes)) return PDF;
    if (type === VCARD && isVcardBytes(bytes)) return VCARD;
  }
  return null;
}

/** "711 KB", "1.5 MB". For the card, so nobody opens a 40 MB file on a phone by surprise. */
export function fileSizeLabel(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/* A safe, readable file name made from the item's name: letters, digits and
   dashes only, so nothing typed into a name can reach a path or a header. */
export function safeFileBase(name) {
  const base = String(name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
    .replace(/-+$/g, "");
  return base || "file";
}

/** Where a room's file is kept in the store. The store adds a random suffix, so two files never collide. */
export function blobPathFor(roomSlug, name, type = PDF) {
  const room = String(roomSlug || "").replace(/[^a-z0-9-]/g, "") || "room";
  return `office/${room}/${safeFileBase(name)}.${kindInfo(type).ext}`;
}

/* The header that names the file when it is opened or saved. The plain
   filename is the safe base (ASCII only); filename* carries the real name for
   browsers that read it, percent-encoded so no quote or line break survives. */
export function contentDisposition(name, type = PDF, fileBase = null) {
  const ext = kindInfo(type).ext;
  const plain = `${fileBase ? safeFileBase(fileBase).replace(/-/g, "_") : safeFileBase(name)}.${ext}`;
  /* v181 (scan): cut by whole characters (half an emoji made the header
     throw, so the file couldn't be opened). */
  const real = fileBase ? plain : (Array.from(String(name || "").replace(/[\u0000-\u001f\u007f]/g, "")).slice(0, 150).join("").trim() || "file");
  const withExt = new RegExp(`\\.${ext}$`, "i").test(real) ? real : `${real}.${ext}`;
  /* A PDF opens in the browser; a contact file is handed to the phone to import. */
  const how = type === VCARD ? "attachment" : "inline";
  return `${how}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(withExt).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

/* The one-time copy reads each file from CIK Office itself. Only from there:
   https, the cikoffice.com host exactly, and the WordPress uploads folder,
   with no user name, password, port or ".." in it. Anything else would let the
   import be pointed at some other address. */
export const IMPORT_FILE_HOST = "cikoffice.com";
export function isImportSource(u) {
  if (typeof u !== "string" || u.length > 500) return false;
  let p;
  try { p = new URL(u); } catch { return false; }
  return p.protocol === "https:" && p.hostname === IMPORT_FILE_HOST && !p.port && !p.username && !p.password &&
    p.pathname.startsWith("/wp-content/uploads/") && !p.pathname.includes("..") && !/%2e|%2f|%5c/i.test(p.pathname) &&
    !p.search && !p.hash;
}

/** The path MRE Office served the file at, kept so the old address can keep working after WordPress goes. */
export function originPathOf(u) {
  try { return new URL(u).pathname; } catch { return ""; }
}

/* An old MRE Office address asked of Jarvis (/wp-content/uploads/<segments>),
   or null if any part is not a plain file or folder name. Only letters,
   digits, dash, underscore and dot; never "." or "..". */
const LEGACY_SEGMENT = /^[A-Za-z0-9_\-.]{1,120}$/;
export function legacyPath(segments) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 8) return null;
  if (!segments.every(s => typeof s === "string" && LEGACY_SEGMENT.test(s) && s !== "." && s !== "..")) return null;
  const path = "/wp-content/uploads/" + segments.join("/");
  return path.length <= 300 ? path : null;
}

export async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check one file's bytes against a room's rule. Returns an error sentence, or "".
 * `files` is the room's `list.files`: { types: ["application/pdf"], maxBytes }.
 */
export function fileProblem(files, bytes) {
  if (!files) return "This list does not hold files.";
  if (!bytes || !bytes.length) return "That file is empty.";
  if (bytes.length > files.maxBytes) return `That file is ${fileSizeLabel(bytes.length)}. The most a file can be is ${fileSizeLabel(files.maxBytes)}.`;
  if (kindOfBytes(files, bytes)) return "";
  const nouns = (files.types || []).map(t => kindInfo(t).noun);
  return `Only ${nouns.join(" or ")} files can be added here.`.replace("contact file (.vcf) files", "contact files (.vcf)");
}

/**
 * Download one file for the one-time copy, from MRE Office only.
 * Redirects are not followed (a redirect could lead anywhere), the size cap is
 * checked before AND while reading, and the bytes must pass fileProblem().
 * Returns { bytes, sha256 } or throws an Error whose message says what was wrong.
 */
export async function downloadImportFile(url, files, fetchImpl = fetch) {
  if (!isImportSource(url)) throw new Error("not a file address on cikoffice.com");
  const res = await fetchImpl(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (res.status !== 200) throw new Error(`CIK Office answered ${res.status} for a file`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > files.maxBytes) throw new Error(`a file is ${fileSizeLabel(declared)}, over the ${fileSizeLabel(files.maxBytes)} cap`);
  const reader = res.body?.getReader?.();
  const chunks = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > files.maxBytes) { try { await reader.cancel(); } catch {} throw new Error(`a file is over the ${fileSizeLabel(files.maxBytes)} cap`); }
      chunks.push(value);
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    total = buf.length; chunks.push(buf);
  }
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  const problem = fileProblem(files, bytes);
  if (problem) throw new Error(problem);
  return { bytes, sha256: await sha256Hex(bytes), type: kindOfBytes(files, bytes) };
}
