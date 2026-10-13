/* Guard against the exact bug that just cost an afternoon: a route file that
   re-exports handler names the source module does not actually export. */
import fs from "node:fs";
let p=0,f=0; const ok=(c,m)=>{c?p++:(f++,console.log("  FAIL:",m));};

/* Strip comments before matching. The route file documents the WRONG pattern
   as a warning, and a naive regex happily matches the cautionary example —
   which is how a guard test reports a failure that does not exist. */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const route  = stripComments(fs.readFileSync("app/api/auth/[...nextauth]/route.js","utf8"));
const authjs = stripComments(fs.readFileSync("auth.js","utf8"));

ok(!/export\s*\{\s*GET\s*,\s*POST\s*\}\s*from/.test(route),
   "route must NOT re-export GET/POST directly from auth.js");
ok(/import\s*\{\s*handlers\s*\}/.test(route), "route imports `handlers`");
ok(/export\s+const\s*\{\s*GET\s*,\s*POST\s*\}\s*=\s*handlers/.test(route),
   "route destructures GET/POST off handlers");
ok(/export\s+const\s*\{[^}]*\bhandlers\b/.test(authjs), "auth.js actually exports `handlers`");

// every API route must define at least one HTTP method export
const allRoutes = (function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(full, out); else if (e.name === "route.js") out.push(full);
  }
  return out;
})("app/api");
ok(allRoutes.length >= 10 && allRoutes.includes("app/api/admin/run/route.js"), `found every API route on disk (${allRoutes.length})`);
for (const f2 of allRoutes) {
  const src = stripComments(fs.readFileSync(f2,"utf8"));
  ok(/export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE)\b|export\s+const\s*\{[^}]*(GET|POST)/.test(src),
     `${f2} exports an HTTP method handler`);
}

/* The two legal pages MUST render for an anonymous visitor. Google will not
   move the OAuth consent screen to production until it can fetch both without
   signing in, and the failure mode is silent: importing auth.js or lib/db.js
   (directly or through a helper) makes the page require a session or a
   DATABASE_URL, and a reviewer sees a 500 rather than a policy. */
for (const page of ["app/privacy/page.jsx", "app/terms/page.jsx", "app/legal-shell.jsx"]) {
  const src = stripComments(fs.readFileSync(page, "utf8"));
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]);
  ok(!imports.some(i => /auth\.js$|\/db\.js$|next-auth/.test(i)),
     `${page} must not import auth or the database`);
  ok(!/currentUser\s*\(|\bauth\s*\(\)/.test(src),
     `${page} must not require a session`);
}
ok(fs.readFileSync("app/signin/page.jsx", "utf8").includes('href="/privacy"'),
   "sign-in page links to the privacy policy");
for (const page of ["app/privacy/page.jsx", "app/terms/page.jsx"]) {
  const src = fs.readFileSync(page, "utf8");
  ok(/\bCOMPANY\b/.test(src) || /Cash Is King/.test(src), `${page} names Cash Is King`);
  ok(/CONTACT_EMAIL/.test(src + fs.readFileSync("app/legal-shell.jsx", "utf8")), `${page} gives the contact address from lib/brand.js`);
}

console.log(`\n${p} passed, ${f} failed`); process.exit(f?1:0);
