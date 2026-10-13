/* Jarvis on the home screen, like an app (from Jarvis v173).
 *
 * Served at /manifest.webmanifest (Next adds the link to every page). A phone
 * that adds it to its home screen gets the Cash Is King logo as the icon and
 * opens it full screen, black, with no browser bar, straight onto the home
 * page. The "maskable" icon leaves room for Android to round or shape it.
 */
export default function manifest() {
  return {
    id: "/",
    name: "Jarvis · Cash Is King",
    short_name: "Jarvis",
    description: "Cash Is King's team command center.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    /* v180 (scan): no orientation lock, so an installed tablet can turn
       sideways into the desktop layout. */
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
