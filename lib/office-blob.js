/* Jarvis's file store: a PRIVATE Vercel Blob store ("jarvis-files").
 *
 * Private means a file's address on its own opens nothing. Every read goes
 * through Jarvis (app/api/office/file/[id]/route.js), which checks who is
 * signed in and whether they may see the room first. On Vercel the store is
 * reached with the project's own short-lived OIDC token, which Vercel adds when
 * the store is connected to the project, so there is no key to copy or leak.
 *
 * The rest of Jarvis only calls the four functions here, so tests can swap in
 * a pretend store and nothing else needs to know how files are kept.
 */
import { put, get, del } from "@vercel/blob";

const REAL = { put, get, del };
let impl = REAL;
/** Tests pass a pretend store; nothing else calls this. */
export function __setBlobForTests(fake) { impl = fake || REAL; }

/** Has a store been connected to this deployment? */
export function blobReady() {
  return impl !== REAL || Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

/** Keep a file. Returns the pathname it was kept under (with the store's random suffix). */
export async function storeFile(pathname, bytes, contentType) {
  const b = await impl.put(pathname, Buffer.from(bytes), {
    access: "private",
    addRandomSuffix: true,
    contentType,
  });
  return b.pathname;
}

/** Read a file. Null if it is not there. Passes the browser's ETag so an unchanged file answers 304. */
export async function readFile(pathname, ifNoneMatch) {
  return impl.get(pathname, { access: "private", ...(ifNoneMatch ? { ifNoneMatch } : {}) });
}

/** Remove files. Never throws: a file that could not be removed is logged, not a failed request. */
export async function removeFiles(pathnames) {
  const list = (pathnames || []).filter(p => typeof p === "string" && p);
  if (!list.length) return true;
  try { await impl.del(list); return true; }
  catch (e) { console.error("office file store: could not remove", list.length, "file(s):", e?.message || e); return false; }
}
