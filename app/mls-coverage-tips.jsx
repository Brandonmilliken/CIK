"use client";
/* The MLS Coverage map's hover behaviour, as MRE Office had it:
 *   - hover or tab to a county: a tip with the county, its MLS, a second MLS
 *     if there is one, and a note when the assignment is not high confidence
 *   - hover an MLS in the legend: every county it covers stays in colour and
 *     the rest fade
 * The tip is built from text nodes only (MRE Office used innerHTML), so even
 * the map's own data is never read as markup.
 */
import { useEffect } from "react";

export default function MlsCoverageTips() {
  useEffect(() => {
    const map = document.getElementById("map");
    const tip = document.getElementById("tip");
    if (!map || !tip) return;
    const off = [];
    const on = (el, ev, fn) => { el.addEventListener(ev, fn); off.push(() => el.removeEventListener(ev, fn)); };
    const counties = [...map.querySelectorAll(".cty")];

    document.querySelectorAll("#lg li").forEach(li => {
      const m = ((li.querySelector(".sw")?.className || "").match(/sw-([A-Za-z]+)/) || [])[1];
      if (!m) return;
      on(li, "mouseenter", () => {
        map.classList.add("focus");
        counties.forEach(p => p.classList.toggle("on", p.dataset.mls === m || p.dataset.dual === m));
      });
      on(li, "mouseleave", () => {
        map.classList.remove("focus");
        counties.forEach(p => p.classList.remove("on"));
      });
    });

    const line = (cls, text) => { const d = document.createElement("div"); d.className = cls; d.textContent = text; return d; };
    const show = (p, x, y) => {
      const d = p.dataset;
      tip.replaceChildren(line("tt", `${d.name} County, ${d.st}`), line("tp", d.full || ""));
      if (d.dualfull) tip.append(line("td", `also on ${d.dualfull}`));
      if (d.conf && d.conf !== "high") tip.append(line("tcf", `${d.conf} confidence — see notes`));
      tip.classList.add("on");
      const r = tip.getBoundingClientRect();
      /* v179 (scan): with Large or Largest text the page is zoomed, and a
         left/top set here is zoomed too, so the tip landed far from the
         pointer (or off screen). Work in screen pixels, then undo the zoom. */
      const z = tip.offsetWidth ? (r.width / tip.offsetWidth) || 1 : 1;
      tip.style.left = Math.max(8, Math.min(x + 16, innerWidth - r.width - 10)) / z + "px";
      tip.style.top = Math.max(8, Math.min(y + 16, innerHeight - r.height - 10)) / z + "px";
    };
    const hide = p => { p.classList.remove("hov"); tip.classList.remove("on"); };
    counties.forEach(p => {
      on(p, "mousemove", e => { p.classList.add("hov"); show(p, e.clientX, e.clientY); });
      on(p, "mouseleave", () => hide(p));
      on(p, "focus", () => { const b = p.getBoundingClientRect(); p.classList.add("hov"); show(p, b.left + b.width / 2, b.top + b.height / 2); });
      on(p, "blur", () => hide(p));
    });
    return () => { off.forEach(f => f()); tip.classList.remove("on"); };
  }, []);
  return null;
}
