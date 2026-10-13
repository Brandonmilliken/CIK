/* The app IS www.cikoffice.com (Brandon, 2026-10-13). Only the bare address
   is "old": it redirects to www once it points at Vercel. */
const OLD_HOSTS = ["cikoffice.com"];

const nextConfig = {
  poweredByHeader: false,
  /* v180 (scan): a room link warmed by hovering was reused for up to five
     minutes, so a click could open a list several minutes old. */
  experimental: { staleTimes: { static: 30 } },
  /* The move (step 5 of the plan, from Jarvis v158). The app is served at
     https://www.cikoffice.com. WordPress keeps the bare cikoffice.com until
     the rooms are copied (the one-time import runs from there). Once
     cikoffice.com also points at Vercel, this sends every page on it to
     https://www.cikoffice.com/. WordPress was one page, so there is nothing
     deeper to map. Old /wp-content/uploads/ files are left alone (public/
     serves any that are kept). Until that DNS change, this rule never
     matches, because cikoffice.com still reaches WordPress.
     Temporary (307) on purpose: browsers remember a permanent redirect for
     good, which would get in the way if the move ever had to be undone. */
  async redirects() {
    return OLD_HOSTS.map(host => ({
      source: "/:path((?!wp-content/uploads/).*)",
      has: [{ type: "host", value: host }],
      destination: "https://www.cikoffice.com/",
      permanent: false,
    }));
  },
  async headers() {
    return [{
      /* v180 (scan): not on the Privacy and Terms pages, which are meant to
         be found (Google's sign-in review reads them); this header beat
         their own "index me". */
      source: "/((?!privacy$|terms$).*)",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    }, {
      source: "/:path*",
      headers: [
        /* This dashboard shows real client names, phone numbers and company
           production figures. None of it belongs in a search index or a referrer. */
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};
export default nextConfig;
