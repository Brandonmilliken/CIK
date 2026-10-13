/* mls-coverage.test.mjs — v95: the MLS Coverage map, copied from MRE Office.
 *
 * The map is fixed content drawn as raw HTML, so these checks hold it to that:
 * nothing in it can run, link out or restyle the rest of Jarvis, and the county
 * data is all there.
 */
import fs from "node:fs";
import { MLS_COVERAGE_CSS, MLS_COVERAGE_HTML, MLS_COVERAGE_SOURCE_SHA256 } from "./lib/mls-coverage-map.js";
import { roomBySlug, canSeeRoom } from "./lib/office-rooms.js";

let p = 0, f = 0;
const ok = (c, m) => { c ? p++ : (f++, console.log("  FAIL:", m)); };
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/* ---- the room ---------------------------------------------------------------- */
{
  const r = roomBySlug("mls-coverage");
  ok(r.where === "jarvis" && r.view === "mls-coverage" && !r.minRole && !r.list, "MLS Coverage has moved, open to everyone, as a page of its own");
  ok(canSeeRoom(r, "agent"), "every agent can open it");
  ok(/^[0-9a-f]{64}$/.test(MLS_COVERAGE_SOURCE_SHA256), "it records which copy of MRE Office's map it came from");
}

/* ---- nothing in it can run or link out ------------------------------------------ */
{
  const h = MLS_COVERAGE_HTML;
  ok(!/<script/i.test(h) && !/<\/?(iframe|object|embed|form|input|button|img|link|meta|base|style)\b/i.test(h), "the map has no script, frame, form, image or style tag");
  ok(!/\son[a-z]+\s*=/i.test(h), "no event handlers");
  ok(!/\b(href|src|action|formaction|xlink:href)\s*=/i.test(h), "no links or sources of any kind");
  ok(!/javascript:|data:|vbscript:/i.test(h), "no script or data addresses");
  ok(!/url\(\s*['"]?(https?:|\/\/|data:)/i.test(MLS_COVERAGE_CSS), "the styles load nothing from anywhere; only the map's own hatch patterns");
  ok(!/@import|expression\(|behavior:|-moz-binding/i.test(MLS_COVERAGE_CSS), "and import nothing");
  ok(!/<\/style/i.test(MLS_COVERAGE_CSS), "the styles cannot close their own style tag");
}

/* ---- it cannot restyle the rest of Jarvis ------------------------------------------- */
{
  const css = MLS_COVERAGE_CSS.replace(/@media[^{]*\{/g, "").replace(/\}\s*\}/g, "}");
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(m => m[1].split(",").map(s => s.trim())).filter(Boolean);
  ok(selectors.length > 100, `the map's ${selectors.length} style rules came across`);
  ok(selectors.every(s => s === ".jx-mlscov" || s.startsWith(".jx-mlscov ") || s.startsWith(".jx-mlscov *")),
     "every one is scoped inside the map, so its h1, table, header and footer rules touch nothing else");
  ok(!/data-mcc-theme/.test(MLS_COVERAGE_CSS), "MRE Office's light-mode switch is left out");
  ok(/\.jx-mlscov #map \.cty\{/.test(MLS_COVERAGE_CSS) && /\.jx-mlscov #tip\{/.test(MLS_COVERAGE_CSS), "the county and tip styles are there");
}

/* ---- the counties ------------------------------------------------------------------ */
{
  const h = MLS_COVERAGE_HTML;
  const counties = [...h.matchAll(/<path class="cty m-([A-Z]+)"[^>]*data-mls="([A-Z]+)" data-name="([^"]+)" data-st="(Oregon|Washington)"[^>]*data-conf="(high|med|low)"/g)];
  ok(counties.length === 75, `all 75 counties are drawn (${counties.length})`);
  ok(counties.filter(c => c[4] === "Oregon").length === 36 && counties.filter(c => c[4] === "Washington").length === 39, "36 in Oregon, 39 in Washington");
  ok(counties.every(c => c[1] === c[2]), "each county's colour matches its MLS");
  const find = (n, st) => counties.find(c => c[3] === n && c[4] === st);
  ok(find("Multnomah", "Oregon")?.[2] === "RMLS" && find("King", "Washington")?.[2] === "NWMLS" && find("Marion", "Oregon")?.[2] === "WVMLS",
     "spot checks: Multnomah is RMLS, King is NWMLS, Marion is WVMLS");
  ok(/data-name="Clark" data-st="Washington"[^>]*data-dual="NWMLS"/.test(h), "Clark County shows its second MLS, NWMLS");
  ok(find("Garfield", "Washington")?.[2] === "NONE", "Garfield County is marked as having no published MLS");
  ok((h.match(/<tr><td class="tc">/g) || []).length === 75, "the two county tables list all 75");
  ok(/<svg id="inset"/.test(h) && /<ul class="legend" id="lg">/.test(h) && /<div id="tip"><\/div>/.test(h), "with the Portland inset, the legend and the tip");
}

/* ---- how it is drawn ------------------------------------------------------------------ */
{
  const comp = strip(fs.readFileSync("app/mls-coverage.jsx", "utf8"));
  ok(/__html: MLS_COVERAGE_HTML/.test(comp) && /__html: MLS_COVERAGE_CSS/.test(comp) && !/"use client"/.test(comp),
     "the map is drawn on the server from the fixed file");
  const tips = strip(fs.readFileSync("app/mls-coverage-tips.jsx", "utf8"));
  ok(!/innerHTML/.test(tips) && /textContent = text/.test(tips), "the hover tip is built from text only");
  ok(/off\.forEach\(f => f\(\)\)/.test(tips), "and its listeners are removed when the page is left");
  const page = strip(fs.readFileSync("app/office/[room]/page.jsx", "utf8"));
  ok(!/dangerouslySetInnerHTML/.test(page) && /<MlsCoverage \/>/.test(page), "the room page itself still renders no raw HTML");
}

console.log(`\nmls-coverage: ${p} passed, ${f} failed`);
if (f) process.exit(1);
