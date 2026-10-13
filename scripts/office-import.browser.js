/* office-import.browser.js — the one-time copy of CIK Office rooms into the new app.
 *
 * WHERE TO RUN IT: in a tab on the bare https://cikoffice.com (WordPress),
 * signed in to WordPress as an admin (wp-admin works), in a browser that is
 * ALSO signed in to the new app (https://www.cikoffice.com) as admin or
 * leadership. Paste it into the page's
 * console (or run it through the Claude browser tool). It reads each room with
 * CIK Office's own WordPress session and posts it straight to the new app. The
 * data never passes through a file or a chat.
 *
 * WHAT IT PRINTS: counts and yes/no answers only, never the items.
 *   match: true  means the new app stored exactly what CIK Office had,
 *                character for character, in order (the fingerprints agree)
 *   409          means the room was already copied, so nothing changed
 *
 * Keep ROOMS in step with the `list.fields` of each room in lib/office-rooms.js
 * (a test checks). CIK Office inventory, 2026-10-13: vendors 244, directory 13,
 * mls 13, gis 10, values 6, tech_stack 5, resources 4, nb_links 4, oh_links 3,
 * offices 2. Every other collection was empty, so there is nothing to copy.
 */
(async () => {
  const APP = "https://www.cikoffice.com";
  const ROOMS = {
    "new-business":    { collection: "nb_links",   keys: ["name", "url"] },
    "open-houses":     { collection: "oh_links",   keys: ["name", "url"] },
    "mls-info":        { collection: "mls",        keys: ["name", "abbr", "area", "description", "support", "phone", "url"] },
    "gis":             { collection: "gis",        keys: ["name", "url", "state", "note"] },
    "vendors":         { collection: "vendors",    keys: ["name", "category", "area", "phone", "email", "website", "description", "preferred"] },
    "company":         { collection: "values",     keys: ["name", "description"] },
    "company~offices": { collection: "offices",    keys: ["name", "address", "phone"] },
    "tech-stack":      { collection: "tech_stack", keys: ["name", "url", "description"] },
    "directory":       { collection: "directory",  keys: ["name", "title", "email", "phone", "secondaryPhone", "group"] },
    "resources":       { collection: "resources",  keys: ["name", "url", "category"] },
  };
  /* Rooms already copied answer 409 and are left exactly as they are, so it is
     safe to run this again. Pass a list to copy only some:
     window.OFFICE_IMPORT_ONLY = ["gis"] */
  const only = Array.isArray(window.OFFICE_IMPORT_ONLY) ? window.OFFICE_IMPORT_ONLY : null;

  async function fingerprint(keys, items) {
    const canon = JSON.stringify(items.map(i => keys.map(k => [k, i[k] ?? ""])));
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  if (location.hostname !== "cikoffice.com") return console.log("Open https://cikoffice.com (no www), signed in to WordPress, and run this there.");
  /* The CIK Office page is password-protected, so its app (and MCC_CONFIG)
     may not be on this page. WordPress hands a signed-in admin a REST nonce
     from admin-ajax either way. */
  const nonce = window.MCC_CONFIG?.nonce
    || await fetch("/wp-admin/admin-ajax.php?action=rest-nonce", { credentials: "include" }).then(r => (r.ok ? r.text() : "")).catch(() => "");
  if (!nonce || nonce === "0") return console.log("Sign in to WordPress (cikoffice.com/wp-admin) first, then run this again.");
  const base = location.origin + "/wp-json/mcc/v1";
  const report = {};

  for (const [room, { collection, keys }] of Object.entries(ROOMS)) {
    if (only && !only.includes(room)) continue;
    const res = await fetch(`${base}/${collection}`, { credentials: "include", headers: { "X-WP-Nonce": nonce } });
    if (!res.ok) { report[room] = { error: `CIK Office answered ${res.status}` }; continue; }
    const body0 = await res.json();
    const all = Array.isArray(body0) ? body0 : (body0.items || []);
    const items = all.map(i => ({
      originId: String(i.id),
      fields: Object.fromEntries(keys.map(k => [k, typeof i[k] === "string" ? i[k] : ""])),
    }));
    const expected = await fingerprint(keys, items.map(i => i.fields));

    const post = await fetch(`${APP}/api/office/import`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, items }),
    });
    const body = await post.json().catch(() => ({}));
    report[room] = post.ok
      ? { status: post.status, sent: items.length, stored: body.imported, match: body.fingerprint === expected }
      : { status: post.status, sent: items.length, error: body.error,
          problems: (body.errors?.problems || []).map(p => `${p.originId ?? "#" + p.index} ${p.field}: ${p.error}`) };
  }
  console.log(JSON.stringify(report, null, 1));
  return report;
})();
