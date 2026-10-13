"use client";
/* The side menu: the dashboard first, then every MRE Office room.
 *
 * Desktop (1000px and up): always open, fixed down the left edge, and the page
 * moves over to make room.
 *
 * Phone and tablet (v124): a bar across the top with a hamburger "Menu"
 * button on the left and a settings (gear) button on the right. The
 * menu slides in from the left over the page. While it is open:
 *   - the page behind it is inert (no Tab, no screen reader, no scroll)
 *   - Tab and Shift+Tab stay inside the menu
 *   - Escape, a tap outside, a swipe to the left, or picking a room closes it
 *   - closing hands focus back to the Menu button
 * On the dashboard the menu also lists "On this page", so one button reaches
 * every section.
 *
 * Settings (everyone, any screen; v132 adds light and dark, dark by default,
 * and a gear in the top right corner on a computer): bigger text, higher contrast,
 * less motion and underlined links. Kept in this browser, and applied
 * before the page paints by the small script in app/layout.jsx.
 *
 * v133: light or dark also follows the PERSON. Picking one saves it to Jarvis
 * (/api/prefs), so every browser and device they sign in on opens in it, and
 * a browser that is already open switches when they come back to it. A pick
 * made in this browser before v133 is saved the first time they visit.
 *
 * v137: for admins and up (whoever can open the Support Center), a bell next
 * to the gear with a red badge counting help tickets still "New", like a
 * Facebook notification. It recounts every minute, when you come back to the
 * tab, and at once when a ticket is filed or changed here. Clicking it opens
 * the Support Center. No badge when there's nothing new.
 *
 * v147 (Jordan, 2026-10-05): "Viewing as: Owner / Manager / Member", for
 * leadership and the super admins only. Owner is you as you are; Manager and
 * Member show the whole of Jarvis (this menu, every room, the dashboard and
 * what the server sends) the way an admin or an agent sees it. It rides on a
 * cookie the server reads (lib/session.js) and can only ever lower what you
 * see. It turns itself off after 8 hours, and a strip across the top of every
 * page says it is on, with a button back.
 *
 * v173 (Brandon, 2026-10-09): "like a web app" on a phone. A bar along the
 * bottom of the screen, in thumb reach: Home, Search, Deals, Menu. The top bar
 * keeps the logo, the bell and the gear. Home and Deals switch the
 * dashboard's tab in place ("jarvis:tab" event) or, from any other page, open
 * the dashboard on it (/?tab=deals). The bar steps out of the way while the
 * keyboard is up. Jarvis can be added to the home screen (app/manifest.js,
 * app/install-hint.jsx) and then opens full screen with its own icon.
 *
 * The dashboard itself (assets/dashboard.html) is not touched by any of this,
 * except that it answers "jarvis:tab" and says which tab it is on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { menuFor, roomBySlug, canSeeRoom } from "../lib/office-menu.js";
import { canPreviewRoles, PREVIEW_COOKIE, PREVIEW_ROLES } from "../lib/role-rank.js";   // v181: not authz.js
import { DISPLAY_KEY, DISPLAY_DEFAULTS, readDisplay, applyDisplay, storedTheme, THEME_UNSYNCED_KEY } from "../lib/display-prefs.js";
import SearchBox, { SearchIcon } from "./search-box.jsx";
import InstallHint from "./install-hint.jsx";
import { JARVIS_FULL, JARVIS_WORDS, LOGO, COMPANY } from "../lib/brand.js";
import "./shell.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/* v180 (scan): focus goes back to the button that opened something only if
   that button can still be seen (one inside the closed phone menu can't, and
   focus fell to the top of the page). Otherwise the first visible fallback. */
function visibleOr(...els) {
  for (const el of els) {
    if (!el || !el.isConnected) continue;
    try {
      if (typeof el.checkVisibility === "function" ? el.checkVisibility({ visibilityProperty: true }) : el.offsetParent !== null) return el;
    } catch { return el; }
  }
  return null;
}

/** Keep Tab inside `box` while it is open. */
function trapTab(e, box) {
  if (e.key !== "Tab" || !box) return;
  const f = [...box.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Save the theme to the person's account. Best effort: if it fails, this
    browser still remembers it, and the next check tries again.
    v180 (scan): a failed save used to be undone by the account's older
    theme on the next check; now it is marked, and re-sent instead. */
const unsynced = on => { try { if (on) localStorage.setItem(THEME_UNSYNCED_KEY, "1"); else localStorage.removeItem(THEME_UNSYNCED_KEY); } catch { /* this visit only */ } };
const isUnsynced = () => { try { return !!localStorage.getItem(THEME_UNSYNCED_KEY); } catch { return false; } };
function saveTheme(theme) {
  unsynced(true);
  try {
    return fetch("/api/prefs", { method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme }) })
      .then(r => { if (r.ok) unsynced(false); return r.ok; }, () => false);
  } catch { return Promise.resolve(false); }
}

/* v147: the three ways to look at Jarvis. "" is no preview: yourself.
   v159 (Brandon, 2026-10-07): named Leadership / Admin / Broker, the words MRE
   uses, instead of Owner / Manager / Member. */
const VIEW_AS = [
  { v: "", label: "Leadership", who: "you" },
  { v: "admin", label: "Admin", who: "admins" },
  { v: "agent", label: "Agent", who: "agents" },   // CIK: "Agent" (Jarvis says "Broker", MRE's word)
];
const PREVIEW_HOURS = 8;

/** Switch the preview and load the page again as that role. A room that role
    can't open sends you to the dashboard instead of a "not found". */
function setPreview(v, path) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = PREVIEW_ROLES.includes(v)
    ? `${PREVIEW_COOKIE}=${v}; Path=/; Max-Age=${PREVIEW_HOURS * 3600}; SameSite=Lax${secure}`
    : `${PREVIEW_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  /* A leader's "View as" one agent starts over too, so the two never mix. */
  /* v181 (scan): every copy (since v180 it is kept per person, under
     "jarvis.viewas:<email>", which this missed). */
  try { Object.keys(sessionStorage).filter(k => k.startsWith("jarvis.viewas")).forEach(k => sessionStorage.removeItem(k)); } catch { /* nothing kept */ }
  const m = /^\/office\/([^/?#]+)/.exec(path || "");
  const room = m && roomBySlug(decodeURIComponent(m[1]));
  if (room && v && !canSeeRoom(room, v)) location.href = "/";
  else location.reload();
}

/** Is the menu a slide-in (phone/tablet) rather than the fixed desktop column? */
const isPhone = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 999.98px)").matches;

/** The dashboard's sections, read from the page when the menu opens. */
/* v170: what the bell says, out loud and on hover. Pure. */
export function bellLabel({ mine = 0, newCount = 0, repliedCount = 0 } = {}, canSupport = false) {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [];
  if (newCount) parts.push(plural(newCount, "new help ticket", "new help tickets"));
  if (repliedCount) parts.push(plural(repliedCount, "ticket an agent replied to", "tickets agents replied to"));
  if (mine) parts.push(plural(mine, "update on your tickets", "updates on your tickets"));
  if (!parts.length) return canSupport ? "Support Center: nothing new" : "My Tickets: no new updates";
  return parts.join(", ").replace(/^./, c => c.toUpperCase());
}

function pageSections() {
  if (typeof document === "undefined") return [];
  return [...document.querySelectorAll("#page section[id]")].map(s => {
    const h = s.querySelector("h2");
    /* The heading's own words, not the badge beside it. v141: the words sit
       in the heading's fold button. */
    const title = s.querySelector("h2 .sectitle");
    const t = title ? title.textContent.trim()
      : h ? [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(" ").trim() : "";
    return { id: s.id, t: t || s.id };
  }).filter(x => x.t);
}

export default function SideMenu({ role, realRole, preview }) {
  const [open, setOpen] = useState(false);
  const [dispOpen, setDispOpen] = useState(false);
  /* v146: Jarvis search (app/search-box.jsx). */
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyHint, setKeyHint] = useState("Ctrl K");
  const searchOpener = useRef(null);
  const [prefs, setPrefs] = useState(DISPLAY_DEFAULTS);
  const [sections, setSections] = useState([]);
  const btnRef = useRef(null);
  const closeRef = useRef(null);
  const navRef = useRef(null);
  const dispRef = useRef(null);
  const dispBtnRef = useRef(null);
  const wasOpen = useRef(false);
  const wasDisp = useRef(false);
  const lastDispOpener = useRef(null);
  const lastThemePick = useRef(0);
  const touch = useRef(null);
  const path = usePathname() || "/";
  const router = useRouter();
  const groups = menuFor(role);
  const onDashboard = path === "/";
  const [going, setGoing] = useState(null);

  /* v173: which dashboard tab is showing, so the bottom bar lights Home or
     Deals. The dashboard says, every time it changes. */
  const [dashTab, setDashTab] = useState(null);
  useEffect(() => {
    const on = e => setDashTab(typeof e.detail === "string" ? e.detail : null);
    window.addEventListener("jarvis:tabchanged", on);
    /* It may have said so before this was listening: ask the page itself. */
    const now = document.getElementById("page")?.dataset?.tab;
    if (now) setDashTab(now);
    return () => window.removeEventListener("jarvis:tabchanged", on);
  }, []);
  /* On the dashboard, Home and Deals switch its tab in place. Anywhere else
     the link opens the dashboard on that tab (a real page load, as every
     link to the dashboard is). */
  const toDashTab = tab => e => {
    setOpen(false);
    if (!onDashboard) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("jarvis:tab", { detail: tab }));
  };
  /* v174: on the dashboard on a phone, a swipe left or right moves to the
     next or previous tab, like an app. Only a clear sideways swipe counts
     (not a scroll), and never one that starts on something that slides
     sideways itself (the row of tabs, a wide table, a chart), in a box
     you type in, or while a menu or sheet is open. */
  useEffect(() => {
    if (!onDashboard) return;
    let start = null;
    const slides = el => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.matches?.("input, textarea, select, [contenteditable=true], .tabbar, #chat, #jump")) return true;
        if (n.scrollWidth > n.clientWidth + 2) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === "auto" || ox === "scroll") return true;
        }
      }
      return false;
    };
    const down = e => {
      start = null;
      if (!isPhone() || e.touches.length !== 1 || document.documentElement.classList.contains("jx-locked")) return;
      /* v177 (scan): zoomed in with two fingers, a sideways drag moves around
         the page; it must not change the tab. */
      if (window.visualViewport && window.visualViewport.scale > 1.02) return;
      /* v180 (scan): not while Ask Matin AI is open over the page. */
      if (document.querySelector("#chat.open")) return;
      if (!e.target.closest?.("#page") || slides(e.target)) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, at: Date.now() };
    };
    const up = e => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y, quick = Date.now() - start.at < 700;
      start = null;
      if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      const tabs = [...document.querySelectorAll('#page > .tabbar [role="tab"]')];
      const i = tabs.findIndex(b => b.getAttribute("aria-selected") === "true");
      const next = tabs[i + (dx < 0 ? 1 : -1)];
      if (i < 0 || !next) return;
      window.dispatchEvent(new CustomEvent("jarvis:tab", { detail: next.dataset.v }));
    };
    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchend", up, { passive: true });
    return () => {
      document.removeEventListener("touchstart", down);
      document.removeEventListener("touchend", up);
    };
  }, [onDashboard]);

  /* v173: while typing, the bottom bar steps aside so it never sits on top of
     the keyboard or the box being typed in. */
  useEffect(() => {
    const typing = el => !!el && (el.tagName === "TEXTAREA" || el.isContentEditable
      || (el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(el.type || "")));
    const sync = () => document.documentElement.classList.toggle("jx-typing", typing(document.activeElement));
    const later = () => setTimeout(sync, 0);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", later);
      document.documentElement.classList.remove("jx-typing");
    };
  }, []);
  /* v147: "Viewing as". Only for leadership and up, by what they really are. */
  const canPreview = canPreviewRoles(realRole || role);
  const viewing = canPreview && PREVIEW_ROLES.includes(preview) ? preview : "";
  const viewingOpt = VIEW_AS.find(o => o.v === viewing) || VIEW_AS[0];
  const [switching, setSwitching] = useState(false);
  const pickView = v => { if (v === viewing || switching) return; setSwitching(true); setPreview(v, path); };
  const viewAs = where => canPreview && (
    <div className={`jx-viewas jx-viewas-${where}`} role="group" aria-label="Viewing as" data-on={!!viewing}>
      <span className="jx-viewaslabel">Viewing as</span>
      <span className="jx-viewasopts">
        {VIEW_AS.map(o => (
          <button type="button" key={o.v || "owner"} aria-pressed={o.v === viewing} disabled={switching}
                  onClick={() => pickView(o.v)} title={o.v ? `See Jarvis the way ${o.who} see it` : "See Jarvis as yourself"}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );

  /* v137: the help-ticket bell. v170: everyone has one. An agent's counts the
     updates on their own tickets they haven't opened, and opens My Tickets.
     An admin's also counts tickets still New and tickets an agent has
     answered, and opens the Support Center while there are any. The server
     decides which numbers each person gets. */
  const canSupport = canSeeRoom(roomBySlug("support"), role);
  const [bellNums, setBellNums] = useState({ mine: 0, newCount: 0, repliedCount: 0 });
  const [bellSaid, setBellSaid] = useState("");
  const lastCount = useRef(null);
  useEffect(() => {
    let last = 0, gone = false, seq = 0;
    const count = async force => {
      if (!force && (document.hidden || Date.now() - last < 15000)) return;
      last = Date.now();
      /* v180 (scan): only the newest count is shown (an older answer arriving
         last put back a number that had already gone down). */
      const mySeq = ++seq;
      try {
        const r = await fetch("/api/tickets", { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
        const nums = { mine: num(d.mine), newCount: canSupport ? num(d.newCount) : 0, repliedCount: canSupport ? num(d.repliedCount) : 0 };
        if (gone || mySeq !== seq) return;
        const total = nums.mine + nums.newCount + nums.repliedCount;
        /* Tell a screen reader when something new arrives (not on the first count). */
        if (lastCount.current != null && total > lastCount.current) setBellSaid(bellLabel(nums, canSupport));
        lastCount.current = total;
        setBellNums(nums);
      } catch { /* offline: keep the last count */ }
    };
    count(true);
    const t = setInterval(() => count(false), 60000);
    const back = () => count(false);
    const now = () => count(true);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    window.addEventListener("jx:tickets", now);
    return () => {
      gone = true; clearInterval(t);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
      window.removeEventListener("jx:tickets", now);
    };
  }, [canSupport]);

  useEffect(() => { setGoing(null); }, [path]);

  /* v125: room pages keep themselves current. Every minute while on screen,
     and at once on coming back to the tab, the page's data is fetched again
     and swapped in place (router.refresh): no reload, no lost search box or
     open form. Skipped while someone is typing, so nothing moves under them.
     The dashboard has its own refresh and is left alone. */
  useEffect(() => {
    if (onDashboard) return;
    let last = Date.now();
    const typing = () => {
      const a = document.activeElement;
      return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    };
    const tick = force => {
      if (document.hidden || typing()) return;
      if (!force && Date.now() - last < 55000) return;
      if (force && Date.now() - last < 15000) return;
      last = Date.now();
      router.refresh();
    };
    const t = setInterval(() => tick(false), 60000);
    const back = () => tick(true);
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [onDashboard, router]);

  useEffect(() => { setPrefs(readDisplay()); }, []);

  /* v133: the theme saved on the account wins. Checked on arrival and each
     time this tab comes back into view (at most every 20 seconds), so light
     picked on the laptop shows up on the phone without touching anything.
     A pick made here in the last 10 seconds is never undone by an answer
     that was already on its way. */
  useEffect(() => {
    let last = 0, first = true;
    const check = async () => {
      if (document.hidden || Date.now() - last < 20000) return;
      last = Date.now();
      const migrate = first;
      try {
        const r = await fetch("/api/prefs", { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) return;
        first = false;     // v180 (scan): only once an answer came back (a 503 skipped it for good)
        const { theme } = await r.json();
        if (Date.now() - lastThemePick.current < 10000) return;
        /* v180 (scan): this browser's pick never reached the account; send
           it again rather than taking the account's older one. */
        if (isUnsynced()) { const mine = storedTheme() || "dark"; saveTheme(mine); return; }
        if (theme === "light" || theme === "dark") {
          const cur = readDisplay();
          /* v181 (scan): against what THIS tab shows too: another tab of
             the same browser already wrote the new theme to this browser's
             storage, so the two "matched" and this tab never switched. */
          const showing = document.documentElement.classList.contains("jx-light") ? "light" : "dark";
          if (cur.theme !== theme || showing !== theme) {
            const next = { ...cur, theme };
            applyDisplay(next);
            try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(next)); } catch { /* this visit only */ }
            setPrefs(next);
          }
        } else if (migrate) {
          const mine = storedTheme();
          if (mine) saveTheme(mine);          // picked before v133: keep it, account-wide
        }
      } catch { /* offline: this browser's pick stands */ }
    };
    check();
    const back = () => check();
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, []);
  useEffect(() => { setOpen(false); setDispOpen(false); setSearchOpen(false); }, [path]);
  /* v181 (scan): display settings changed in another tab of this browser
     show here at once. */
  useEffect(() => {
    const onStorage = e => {
      if (e.key !== DISPLAY_KEY) return;
      const next = readDisplay();
      applyDisplay(next);
      setPrefs(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* Opening moves focus into the menu; closing hands it back to the Menu
     button, so a keyboard or screen-reader user is never left on something
     that just slid off the screen. */
  useEffect(() => {
    if (open) { if (onDashboard) setSections(pageSections()); closeRef.current?.focus(); }
    else if (wasOpen.current) btnRef.current?.focus();
    wasOpen.current = open;
  }, [open, onDashboard]);

  useEffect(() => {
    if (dispOpen) (dispRef.current?.querySelector("input:checked") || dispRef.current?.querySelector("input"))?.focus();
    else if (wasDisp.current) visibleOr(lastDispOpener.current, dispBtnRef.current, btnRef.current)?.focus();
    wasDisp.current = dispOpen;
  }, [dispOpen]);

  /* v146: Ctrl+K (Cmd+K on a Mac) opens search from anywhere. */
  useEffect(() => {
    try { if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "")) setKeyHint("\u2318K"); } catch { /* keep Ctrl K */ }
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        /* v179 (scan): pressed again while open, it closes like Escape and
           puts focus back where it was (it lost it to the page before). */
        if (searchOpenRef.current) { closeSearchRef.current(); return; }
        searchOpener.current = document.activeElement;
        setOpen(false); setDispOpen(false);
        if (onDashboard) setSections(pageSections());
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDashboard]);
  const openSearch = e => {
    searchOpener.current = e?.currentTarget || document.activeElement;
    setOpen(false); setDispOpen(false);
    if (onDashboard) setSections(pageSections());
    setSearchOpen(true);
  };
  const closeSearch = navigating => {
    setSearchOpen(false);
    if (!navigating) setTimeout(() => visibleOr(searchOpener.current, btnRef.current)?.focus?.(), 0);
  };
  const searchOpenRef = useRef(false);
  const closeSearchRef = useRef(closeSearch);
  searchOpenRef.current = searchOpen;
  closeSearchRef.current = closeSearch;

  /* While the phone menu, the settings sheet or search is open, the page
     behind it cannot be reached or scrolled. */
  useEffect(() => {
    const modal = (open && isPhone()) || dispOpen || searchOpen;
    const main = document.getElementById("jx-content");
    const bar = document.querySelector(".jx-bar");
    const tabs = document.querySelector(".jx-tabbar");
    /* v173: the bottom bar too, except its Menu button's own job is done by
       the menu's Close button and a tap outside. */
    [main, bar, tabs].forEach(el => { if (el) { if (modal) el.setAttribute("inert", ""); else el.removeAttribute("inert"); } });
    const top = document.querySelector(".jx-topbar");
    if (top) { if (searchOpen) top.setAttribute("inert", ""); else top.removeAttribute("inert"); }
    /* v179 (scan): with search or settings open, the side menu, the desktop
       bell and gear, the preview strip, the install card and the skip link
       are out of reach too (Tab used to walk out of the dialog into them). */
    /* v180 (scan): with the phone menu open too (they were reachable under
       its scrim). */
    const behind = (searchOpen || dispOpen || (open && isPhone()))
      ? [...document.querySelectorAll(".jx-side, .jx-geardesk, .jx-belldesk, .jx-previewstrip, .jx-install, .jx-skip")]
          .filter(el => !el.closest("[role=dialog]") && !(open && !searchOpen && !dispOpen && el.classList.contains("jx-side")))
      : [];
    behind.forEach(el => el.setAttribute("inert", ""));
    document.documentElement.classList.toggle("jx-locked", modal);
    return () => {
      [main, bar, top, tabs, ...behind].forEach(el => el && el.removeAttribute("inert"));
      document.documentElement.classList.remove("jx-locked");
    };
  }, [open, dispOpen, searchOpen]);

  /* v179 (scan): the phone menu closes when the screen becomes computer
     width (an iPad turned sideways). It stayed "open" and kept the page
     locked, with its Close button hidden at that width. */
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia("(max-width: 999.98px)"); } catch { return; }
    const onChange = () => { if (!mq.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener("change", onChange); else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);

  useEffect(() => {
    if (!open && !dispOpen) return;
    const onKey = e => {
      if (e.key === "Escape") { if (dispOpen) setDispOpen(false); else setOpen(false); return; }
      if (dispOpen) trapTab(e, dispRef.current);
      else if (open && isPhone()) trapTab(e, navRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dispOpen]);

  const setPref = useCallback((k, v) => {
    setPrefs(prev => {
      const next = { ...prev, [k]: v };
      applyDisplay(next);
      try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(next)); } catch { /* private mode: this visit only */ }
      return next;
    });
    if (k === "theme") { lastThemePick.current = Date.now(); saveTheme(v); }
  }, []);
  const resetPrefs = () => {
    applyDisplay(DISPLAY_DEFAULTS);
    setPrefs(DISPLAY_DEFAULTS);
    try { localStorage.removeItem(DISPLAY_KEY); } catch { /* nothing stored */ }
    lastThemePick.current = Date.now();
    saveTheme(DISPLAY_DEFAULTS.theme);        // "standard" is dark, on every device
  };
  /* v179 (scan): settings and search are never open together (settings
     opened under search's overlay, with the keyboard trapped in it). */
  const openDisplay = e => { lastDispOpener.current = e.currentTarget; setOpen(false); setSearchOpen(false); setDispOpen(true); };

  const bell = cls => {
    const n = bellNums.mine + bellNums.newCount + bellNums.repliedCount;
    const label = bellLabel(bellNums, canSupport);
    /* Where the bell goes: the Support Center while it has something waiting
       (or always, for an admin with nothing new anywhere); My Tickets when
       only the viewer's own tickets have news, and always for an agent. */
    const href = canSupport && (bellNums.newCount + bellNums.repliedCount > 0 || !bellNums.mine) ? "/office/support" : "/office/my-tickets";
    const inner = (
      <>
          <svg className="jx-bellicon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 2H4.4l1.6-2Z M9.8 20.5a2.3 2.3 0 0 0 4.4 0" />
          </svg>
        {n > 0 && <span className="jx-bellcount" aria-hidden="true">{n > 99 ? "99+" : n}</span>}
        <span className="jx-sr">{label}</span>
      </>
    );
    const here = path === href;
    /* To a room from the dashboard is a real page load, as everywhere else. */
    return onDashboard
      ? <a href={href} className={cls} title={label} data-new={n > 0} aria-current={here ? "page" : undefined}>{inner}</a>
      : <Link href={href} prefetch={false} className={cls} title={label} data-new={n > 0} aria-current={here ? "page" : undefined}
              onClick={e => { if (here) { e.preventDefault(); router.refresh(); } }}>{inner}</Link>;
    /* v177 (scan): tapped while already on that page, it fetches the page's
       tickets again (a link to where you are does nothing by itself). */
  };

  /* A swipe to the left closes the phone menu. */
  const onTouchStart = e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = e => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (dx < -60 && Math.abs(dy) < 50) setOpen(false);
  };

  const goTo = id => {
    setOpen(false);
    /* After the menu has closed and the page is reachable again. */
    setTimeout(() => {
      const sec = document.getElementById(id);
      if (!sec) return;
      /* v141: a folded section opens for the jump (the dashboard listens). */
      try { window.dispatchEvent(new CustomEvent("jarvis:open-section", { detail: id })); } catch { /* old browser */ }
      const reduce = document.documentElement.classList.contains("jx-motion-reduce")
        || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      sec.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      const h = sec.querySelector("h2 .secbtn") || sec.querySelector("h2") || sec;
      if (!h.matches("button")) h.setAttribute("tabindex", "-1");
      h.focus({ preventScroll: true });
    }, 60);
  };

  /* v125: room to room is an in-app move (no reload, the menu stays put, the
     next room is fetched when you point at or touch its link). To or from
     the dashboard is a normal page load, because the dashboard runs its own
     script that only starts on a real load. */
  const link = (href, label, extra) => {
    const here = path === href;
    const inApp = !onDashboard && href !== "/";
    const inner = <><span className="jx-itemlabel">{label}</span>{extra}</>;
    if (!inApp) {
      return <a key={href} href={href} className="jx-item" aria-current={here ? "page" : undefined}>{inner}</a>;
    }
    const warm = () => { try { router.prefetch(href, { kind: "full" }); } catch { /* best effort */ } };
    return (
      <Link key={href} href={href} prefetch={false} className="jx-item" aria-current={here ? "page" : undefined}
            onMouseEnter={warm} onFocus={warm}
            onClick={e => {
              /* v179 (scan): a Ctrl/Cmd/Shift or middle click opens a new
                 tab; this one isn't going anywhere, so no loading bar. */
              /* v181 (scan): the room you're already in closes the phone menu
                 (the address doesn't change, so nothing else did). */
              if (here) { setOpen(false); return; }
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button != null && e.button !== 0)) return;
              setGoing(href); setTimeout(() => setGoing(null), 10000); }}>
        {inner}
      </Link>
    );
  };

  const radio = (value, label) => (
    <label className="jx-seg" key={value}>
      <input type="radio" name="jx-text" value={value} checked={prefs.text === value}
             onChange={() => setPref("text", value)} />
      <span>{label}</span>
    </label>
  );
  const themeRadio = (value, label, icon) => (
    <label className="jx-seg" key={value}>
      <input type="radio" name="jx-theme" value={value} checked={prefs.theme === value}
             onChange={() => setPref("theme", value)} />
      <span><span aria-hidden="true" className="jx-segicon">{icon}</span>{label}</span>
    </label>
  );
  const toggle = (key, label, help) => (
    <label className="jx-toggle">
      <input type="checkbox" checked={!!prefs[key]} onChange={e => setPref(key, e.target.checked)} />
      <span className="jx-toggletext"><span className="jx-togglelabel">{label}</span><span className="jx-togglehelp">{help}</span></span>
    </label>
  );

  return (
    <>
      <a className="jx-skip" href="#jx-content">Skip to content</a>
      {/* v125: a thin bar across the top while the next room loads. */}
      <div className="jx-progress" data-on={!!going} role="progressbar" aria-hidden={!going} aria-label="Loading page" />

      {/* v173: on a phone the top bar is the logo, the bell and the gear;
          Menu and Search moved to the bar along the bottom (below). */}
      <header className="jx-bar">
        <a href="/" className="jx-brand" aria-label="Jarvis dashboard">
          <img className="jx-mk jx-mkimg" src={LOGO} alt="" width="34" height="34" aria-hidden="true" />
          <span className="jx-brandtext">Jarvis</span>
        </a>
        {bell("jx-bell jx-bellbar")}
        <button type="button" className="jx-dispbtn" ref={dispBtnRef} aria-controls="jx-display"
                aria-expanded={dispOpen} onClick={openDisplay}>
          <svg className="jx-gearicon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14.2 2.6h-4l-.3 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2.6 1.5l.3 2.5h4l.3-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5Z" />
          </svg><span className="jx-sr">Settings</span>
        </button>
      </header>
      {/* v132: on a computer there is no bar, so the settings button sits in
          the top right corner of every page. v137: the bell sits beside it. */}
      {bell("jx-bell jx-belldesk")}
      <span className="jx-sr" role="status" aria-live="polite">{bellSaid}</span>
      <button type="button" className="jx-geardesk" aria-controls="jx-display" aria-expanded={dispOpen}
              onClick={openDisplay} title="Settings">
        <svg className="jx-gearicon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14.2 2.6h-4l-.3 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2.6 1.5l.3 2.5h4l.3-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5Z" />
          </svg><span className="jx-sr">Settings</span>
      </button>

      {/* v146 (Jordan): on a computer, a bar across the top of every page, as
          in MRE Office: search on the left, the bell and gear on the right. */}
      <div className="jx-topbar">
        <button type="button" className="jx-searchtrigger" onClick={openSearch} aria-haspopup="dialog">
          <SearchIcon />
          <span className="jx-searchph">Search pages, vendors, people, links…</span>
          <kbd className="jx-kbd" aria-hidden="true">{keyHint}</kbd>
          <span className="jx-sr">Search Jarvis</span>
        </button>
        {viewAs("top")}
      </div>
      {/* v147: while previewing, a strip across the top of every page says so. */}
      {viewing && (
        <div className="jx-previewstrip" role="status">
          <span><b>Previewing as {viewingOpt.label}.</b> This is what {viewingOpt.who} see. Your own access hasn&rsquo;t changed.</span>
          <button type="button" onClick={() => pickView("")} disabled={switching}>Back to Leadership</button>
        </div>
      )}
      <SearchBox open={searchOpen} onClose={closeSearch} role={role} onDashboard={onDashboard} sections={sections} />

      {/* v173: the phone's bottom bar. */}
      <nav className="jx-tabbar" aria-label="Quick links">
        <a href="/" className="jx-tab" onClick={toDashTab("home")}
           aria-current={onDashboard && (dashTab === "home" || !dashTab) && !open && !searchOpen ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path d="M3.5 10.5 12 3.8l8.5 6.7V20a1 1 0 0 1-1 1H15v-6.2H9V21H4.5a1 1 0 0 1-1-1v-9.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          <span>Home</span>
        </a>
        <button type="button" className="jx-tab" onClick={openSearch} aria-haspopup="dialog" aria-expanded={searchOpen}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="m15.2 15.2 5.3 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>Search</span>
        </button>
        <a href="/?tab=deals" className="jx-tab" onClick={toDashTab("deals")}
           aria-current={onDashboard && dashTab === "deals" && !open && !searchOpen ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path d="M4 8.5h16a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z M9 8.5V6.2A1.2 1.2 0 0 1 10.2 5h3.6A1.2 1.2 0 0 1 15 6.2v2.3 M3 13.5h18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
          <span>Deals</span>
        </a>
        <button type="button" className="jx-tab" ref={btnRef} aria-controls="jx-side" aria-expanded={open}
                onClick={() => setOpen(o => !o)}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
          <span>Menu</span>
        </button>
      </nav>
      <InstallHint locked={open || dispOpen || searchOpen} />

      <div className="jx-scrim" data-open={open} onClick={() => setOpen(false)} aria-hidden="true" />

      <nav id="jx-side" className="jx-side" data-open={open} aria-label="Jarvis" ref={navRef}
           onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button type="button" className="jx-closebtn" ref={closeRef} onClick={() => setOpen(false)}>
          <span aria-hidden="true">✕</span> Close menu
        </button>
        {/* v146: the logo at the top of the menu on a computer, as in MRE Office. */}
        <a href="/" className="jx-sidebrand" aria-label={`Jarvis, ${JARVIS_FULL}, ${COMPANY}: Home`}>
          <img className="jx-mk jx-mkimg" src={LOGO} alt="" width="34" height="34" aria-hidden="true" />
          <span className="jx-sbtext"><span className="jx-sbname">Jarvis</span><span className="jx-sbsub">{COMPANY}</span></span>
        </a>
        {/* v157: what the name stands for, the first letters picked out. */}
        <p className="jx-sbfull" aria-hidden="true">
          {JARVIS_WORDS.map(([a, rest], i) => <span key={i}>{i ? " " : ""}<b>{a}</b>{rest}</span>)}
        </p>
        {viewAs("side")}
        <div className="jx-group">
          <div className="jx-grouplabel">Workspace</div>
          {link("/", "Dashboard")}
        </div>

        {onDashboard && sections.length > 0 && (
          <div className="jx-group jx-onpage">
            <div className="jx-grouplabel" id="jx-onpage-label">On this page</div>
            <ul className="jx-onpagelist" aria-labelledby="jx-onpage-label">
              {sections.map(s => (
                <li key={s.id}><button type="button" className="jx-item jx-jump" onClick={() => goTo(s.id)}>{s.t}</button></li>
              ))}
            </ul>
          </div>
        )}

        {groups.map(g => (
          <div className="jx-group" key={g.label}>
            <div className="jx-grouplabel">{g.label}</div>
            {g.rooms.map(r => link(
              `/office/${r.slug}`,
              r.label,
              r.where === "office"
                ? <><span className="jx-dot" title="Still in CIK Office" aria-hidden="true" /><span className="jx-sr"> (still in CIK Office)</span></>
                : null,
            ))}
          </div>
        ))}

        <div className="jx-foot">
          <p className="jx-footname">J.A.R.V.I.S. &middot; {JARVIS_FULL} &middot; {COMPANY}</p>
          <button type="button" className="jx-footbtn" aria-controls="jx-display" aria-expanded={dispOpen} onClick={openDisplay}>
            <span aria-hidden="true">⚙</span> Settings
          </button>
        </div>
      </nav>

      <div className="jx-scrim jx-dispscrim" data-open={dispOpen} onClick={() => setDispOpen(false)} aria-hidden="true" />
      <div id="jx-display" className="jx-display" role="dialog" aria-modal="true" aria-labelledby="jx-display-title"
           data-open={dispOpen} ref={dispRef} hidden={!dispOpen}>
        <div className="jx-disphead">
          <h2 id="jx-display-title">Settings</h2>
          <button type="button" className="jx-ghost" onClick={() => setDispOpen(false)}>Done</button>
        </div>
        <p className="jx-disphelp">Light or dark follows you to every device you sign in on. The rest apply to this device only.</p>
        {/* v132: light or dark. Dark is the default. */}
        <fieldset className="jx-fs">
          <legend>Appearance</legend>
          <div className="jx-segs jx-segs2">
            {themeRadio("dark", "Dark", "☾")}
            {themeRadio("light", "Light", "☀")}
          </div>
        </fieldset>
        <fieldset className="jx-fs">
          <legend>Text size</legend>
          <div className="jx-segs">
            {radio("normal", "Standard")}
            {radio("large", "Large")}
            {radio("xlarge", "Largest")}
          </div>
        </fieldset>
        {toggle("contrast", "Higher contrast", "Brighter text and stronger lines")}
        {toggle("motion", "Less motion", "No sliding or smooth scrolling")}
        {toggle("links", "Underline links", "Easier to tell links from text")}
        <button type="button" className="jx-more jx-reset" onClick={resetPrefs}>Reset to standard</button>
      </div>
    </>
  );
}
