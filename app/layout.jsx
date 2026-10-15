import { JARVIS_TITLE } from "../lib/brand.js";
import { displayBoot } from "../lib/display-prefs.js";

/* v133: the theme this person picked, saved on the server, so every browser
   they sign in on opens in it. Never throws and never holds the page up for
   long (lib/user-prefs.js); signed out, or nothing saved, is null. */
/* v180 (scan): the session and settings code (which needs the database) is
   loaded here, inside the try, not at the top: the Privacy, Terms and
   sign-in pages share this layout and must render with no database. */
async function savedTheme() {
  try {
    const [{ currentUser }, { themeFor }] = await Promise.all([import("../lib/session.js"), import("../lib/user-prefs.js")]);
    const user = await currentUser();
    return user?.email ? await themeFor(user.email) : null;
  } catch { return null; }
}

export const metadata = {
  title: JARVIS_TITLE,
  robots: { index: false, follow: false },
  /* v173: added to an iPhone's home screen, Jarvis opens full screen with
     its own icon and name, and the black bar at the top runs up under the
     clock (the top bar already keeps clear of it with safe-area padding). */
  appleWebApp: { capable: true, title: "Jarvis", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

/* v180 (scan): the viewport, through Next. A hand-written viewport tag sat
   beside Next's own default one, and after the first in-app page change
   Next's was re-added last and won, so viewport-fit=cover (the notch and
   home-bar spacing) was lost partway through a session. Zooming is never
   turned off: pinch-zoom is how many people read. */
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }) {
  const theme = await savedTheme();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* viewport-fit=cover is set by `viewport` above, so the bar and
            buttons keep clear of a phone's notch and home bar
            (env(safe-area-inset-*) in shell.css). theme-color stays here:
            the display settings change it. */}
        <meta name="theme-color" content="#000000" />
        {/* v124: the reader's display settings, before the first paint.
            v133: with the theme they saved, which wins over this browser's. */}
        <script dangerouslySetInnerHTML={{ __html: displayBoot(theme) }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" />
      </head>
      <body style={{ margin: 0, background: "#000000" }}>{children}</body>
    </html>
  );
}
