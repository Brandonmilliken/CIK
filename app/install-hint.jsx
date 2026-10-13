"use client";
/* v173 (Brandon, 2026-10-09): "make it like a web app". On a phone, in the
 * browser, a small card offers to put Jarvis on the home screen, where it
 * opens full screen with its own icon (app/manifest.js).
 *
 *   - Android / Chrome: an Install button (the browser's own install prompt).
 *   - iPhone / iPad: Safari has no button for this, so the card says how:
 *     Share, then Add to Home Screen.
 *
 * Never shown once Jarvis is already opened from the home screen, on a
 * computer, or after "Not now" (remembered on this device only).
 */
import { useEffect, useState } from "react";

const KEY = "jarvis.installhint";
const isStandalone = () => {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch { return false; }
};
const isPhoneWidth = () => {
  try { return window.matchMedia("(max-width: 999.98px)").matches; } catch { return false; }
};
/* iPads report themselves as a Mac; a touch screen gives them away. */
const isIOS = () => {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

/* v180 (scan): `locked` while a menu or dialog is open, so a card that
   appears late is out of reach under it too. */
export default function InstallHint({ locked = false }) {
  const [mode, setMode] = useState(null);      // null (hidden), "ios", or "prompt"
  const [deferred, setDeferred] = useState(null);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === "no"; } catch { /* private mode: show it */ }
    if (dismissed || isStandalone()) return;
    const onPrompt = e => {
      e.preventDefault();                 // keep the browser's own mini-bar away; ours offers it
      setDeferred(e);
      if (isPhoneWidth()) setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => setMode(null);
    window.addEventListener("appinstalled", onInstalled);
    /* A moment after the page settles, so it never jumps in while loading. */
    const t = setTimeout(() => { if (isIOS() && isPhoneWidth()) setMode(m => m || "ios"); }, 2500);
    return () => {
      clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /* v181 (scan): the page knows the card is up (shell.css moves the
     dashboard's notices out of its way; the rule matching the card itself
     could never reach a notice outside the shell). */
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("jx-installcard", !!mode);
    return () => el.classList.remove("jx-installcard");
  }, [mode]);

  if (!mode) return null;
  const hide = () => {
    setMode(null);
    try { localStorage.setItem(KEY, "no"); } catch { /* this visit only */ }
  };
  const install = async () => {
    if (!deferred) return;
    try {
      deferred.prompt();
      await deferred.userChoice;
    } catch { /* the browser said no */ }
    /* v177 (scan): the browser offers its prompt once per visit. Accepted or
       not, the card goes (a dead Install button helps no one); a "no" here
       isn't remembered, so it can offer again another day. */
    setDeferred(null);
    setMode(null);
  };

  return (
    <aside className="jx-install" role="region" aria-label="Add Jarvis to your home screen" inert={locked || undefined}>
      <img src="/brand/icon-192.png" alt="" width="40" height="40" className="jx-installicon" />
      <div className="jx-installtext">
        <p className="jx-installtitle">Put Jarvis on your home screen</p>
        {mode === "ios" ? (
          <p className="jx-installhow">
            Tap <span className="jx-installshare" aria-label="Share">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v8.5h14V11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg></span> Share, then <b>Add to Home Screen</b>. It opens full screen, like an app.
          </p>
        ) : (
          <p className="jx-installhow">It opens full screen with its own icon, like an app.</p>
        )}
      </div>
      <div className="jx-installbtns">
        {mode === "prompt" && <button type="button" className="jx-btn jx-btnsm" onClick={install}>Install</button>}
        <button type="button" className="jx-ghost" onClick={hide}>Not now</button>
      </div>
    </aside>
  );
}
