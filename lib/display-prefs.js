/* Display settings (v124): bigger text, higher contrast, less motion,
 * underlined links. Chosen in the menu's "Display settings" sheet, kept in
 * this browser's localStorage (a per-device convenience, never sent to the
 * server), and applied as classes on <html>, which app/shell.css reads:
 *   jx-text-large | jx-text-xlarge
 *   jx-contrast
 *   jx-motion-reduce
 *   jx-links
 *   jx-light                      (v132: light theme; dark is the default.
 *                                  v133: the theme also follows the person
 *                                  to every browser, see lib/user-prefs.js)
 * Standard settings add no class at all. (Classes rather than attributes so
 * every rule in shell.css still starts with .jx-.)
 */
export const DISPLAY_KEY = "jx-display";
/* v132: theme. Dark is the default and adds no class; light adds jx-light. */
export const DISPLAY_DEFAULTS = Object.freeze({ theme: "dark", text: "normal", contrast: false, motion: false, links: false });
const TEXTS = new Set(["normal", "large", "xlarge"]);

/** Whatever was stored, cleaned up; anything odd falls back to standard. */
export function cleanDisplay(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    theme: o.theme === "light" ? "light" : "dark",
    text: TEXTS.has(o.text) ? o.text : "normal",
    contrast: o.contrast === true,
    motion: o.motion === true,
    links: o.links === true,
  };
}

export function readDisplay() {
  try { return cleanDisplay(JSON.parse(localStorage.getItem(DISPLAY_KEY) || "null")); }
  catch { return { ...DISPLAY_DEFAULTS }; }
}

export const DISPLAY_CLASSES = ["jx-light", "jx-text-large", "jx-text-xlarge", "jx-contrast", "jx-motion-reduce", "jx-links"];
export const THEME_COLORS = Object.freeze({ dark: "#000000", light: "#f6f4ef" });

export function applyDisplay(p, el = typeof document !== "undefined" ? document.documentElement : null) {
  if (!el) return;
  const d = cleanDisplay(p);
  el.classList.remove(...DISPLAY_CLASSES);
  if (d.text !== "normal") el.classList.add("jx-text-" + d.text);
  if (d.contrast) el.classList.add("jx-contrast");
  if (d.motion) el.classList.add("jx-motion-reduce");
  if (d.links) el.classList.add("jx-links");
  if (d.theme === "light") el.classList.add("jx-light");
  /* The phone's own status bar follows the theme. */
  if (typeof document !== "undefined" && el === document.documentElement) {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", THEME_COLORS[d.theme]);
  }
}

/* Runs in <head> before the page paints, so a large-text reader never sees
   the page jump from small to large. Same rules as cleanDisplay/applyDisplay,
   written out because it runs before any module has loaded.

   v133: `saved` is the theme this person picked, as saved on the server
   (lib/user-prefs.js). When there is one it wins over whatever this browser
   remembered, and this browser is updated to match, so a new laptop or phone
   opens in the right theme from the very first paint. */
/* v180 (scan): set while a theme pick hasn't reached the account yet (the
   save failed), so the account's older theme doesn't undo it. */
export const THEME_UNSYNCED_KEY = "jarvis.themeUnsynced";
export function displayBoot(saved = null) {
  const s = saved === "light" || saved === "dark" ? saved : "";
  return `(function(){try{var k=${JSON.stringify(DISPLAY_KEY)},o=null;try{o=JSON.parse(localStorage.getItem(k)||"null")}catch(e){}o=o&&typeof o==="object"?o:{};var c=document.documentElement.classList;`
    + (s ? `var u=null;try{u=localStorage.getItem(${JSON.stringify(THEME_UNSYNCED_KEY)})}catch(e){}if(u!=="1"&&o.theme!==${JSON.stringify(s)}){o.theme=${JSON.stringify(s)};try{localStorage.setItem(k,JSON.stringify(o))}catch(e){}}` : "")
    + `if(o.text==="large"||o.text==="xlarge")c.add("jx-text-"+o.text);`
    + `if(o.contrast===true)c.add("jx-contrast");`
    + `if(o.motion===true)c.add("jx-motion-reduce");`
    + `if(o.links===true)c.add("jx-links");`
    + `if(o.theme==="light"){c.add("jx-light");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(THEME_COLORS.light)});}}catch(x){}})();`;
}
export const DISPLAY_BOOT = displayBoot(null);

/** Did this browser store a theme of its own (as opposed to the default)? */
export function storedTheme() {
  try {
    const o = JSON.parse(localStorage.getItem(DISPLAY_KEY) || "null");
    return o && (o.theme === "light" || o.theme === "dark") ? o.theme : null;
  } catch { return null; }
}
