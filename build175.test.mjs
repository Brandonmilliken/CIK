/* build175.test.mjs — v175 (Brandon, 2026-10-09), overhaul phase 3: the rooms
 * on a phone. Call / Text / Email buttons, pinned search and filters in one
 * sliding row, tighter cards. No change on a computer. */
import fs from "node:fs";
let p = 0, f = 0;
const ok = (c, m) => { if (c) p++; else { f++; console.log("  FAIL:", m); } };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const list = strip(fs.readFileSync("./app/office-list.jsx", "utf8"));
ok(/const smsHref = v => telHref\(v\)\.replace\(\/\^tel:\/, "sms:"\);/.test(list), "a text goes to the same number a call does, built only from its digits");
ok((list.match(/className="jx-cline jx-ccall"/g) || []).length === 2 && (list.match(/className="jx-cline jx-ctext"/g) || []).length === 2, "every card with a phone, and the fixed contact cards, get Call and Text");
ok((list.match(/className="jx-cline jx-cmail"/g) || []).length === 2, "and Email");
ok(/aria-label=\{`Text \$\{title \|\| it\.fields\.phone\}`\}/.test(list), "Text says who, to a screen reader");
ok(/<div className="jx-chiprow">\s*\{groups[\s\S]*?aria-label="Tags"[\s\S]*?aria-label="Filter"[\s\S]*?<\/div>\s*\)\}\s*<\/div>\s*<span className="jx-count">/.test(list), "all the filter rows sit in one row that can slide");
ok(/href=\{`mailto:\$\{e\}`\}/.test(list) && /\/\^\[A-Za-z0-9\._%\+-\]\+@/.test(list), "email buttons are still only for plain addresses");

const css = fs.readFileSync("./app/shell.css", "utf8");
const v = css.slice(css.lastIndexOf("/*", css.indexOf("v175: the rooms on a phone")));
ok(/^\.jx-ctext \{ display: none; \}$/m.test(v) && /^\.jx-chiprow \{ display: contents; \}$/m.test(v), "on a computer: no Text button, and the filters lay out as before");
ok(/a\.jx-ccall, \.jx-room \.jx-contact a\.jx-ctext, \.jx-room \.jx-contact a\.jx-cmail \{[^}]*min-height: 44px;[^}]*border-radius: 999px;/.test(v), "on a phone: round buttons a thumb can hit");
ok(/\.jx-ccall \{ order: 1; \}/.test(v) && /\.jx-ctext \{ order: 2; \}/.test(v) && /\.jx-cmail \{ order: 3; \}/.test(v), "Call and Text first, then Email");
ok(/mask: var\(--jx-ico\)/.test(v) && (v.match(/--jx-ico: url\("data:image\/svg\+xml,/g) || []).length === 3, "each with its own icon, drawn in gold");
ok(/\.jx-room \.jx-filters \{\s*position: sticky; top: calc\(var\(--jx-barh\) \+ env\(safe-area-inset-top\)\);/.test(v), "search and filters stay pinned under the top bar");
ok(/\.jx-room \.jx-filters \.jx-chiprow \{[^}]*flex-wrap: nowrap; overflow-x: auto;/.test(v), "filters in one row that slides sideways");
ok(/\.jx-search:placeholder-shown ~ \.jx-count \{ display: none; \}/.test(v), "the count shows while searching");
ok(/\.jx-room \.jx-cardi \{ padding: 14px 14px 12px; \}/.test(v) && /\.jx-room h1 \{ font-size: 25px; \}/.test(v), "tighter cards and header");
const selectors = [...strip(v).matchAll(/(^|})\s*([^{}@]+)\{/g)].map(m => m[2].trim()).flatMap(s => s.split(",").map(x => x.trim())).filter(Boolean);
ok(selectors.length > 10 && selectors.every(s => /^\.jx-/.test(s)), "every rule stays inside Jarvis's own names");

console.log(`\nbuild175: ${p} passed, ${f} failed`);
if (f) process.exit(1);
