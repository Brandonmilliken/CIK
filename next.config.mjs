const OLD_HOSTS = ["cikoffice.com", "www.cikoffice.com"];

const nextConfig = {
  poweredByHeader: false,
  /* v180 (scan): a room link warmed by hovering was reused for up to five
     minutes, so a click could open a list several minutes old. */
  experimental: { staleTimes: { static: 30 } },
  /* The move (step 5 of the plan, from Jarvis v158): once cikoffice.com and
     www.cikoffice.com point at Vercel, this app answers them and sends every
     page to https://jarvis.cikoffice.com/. WordPress was one page, so there
     is nothing deeper to map. Old /wp-content/uploads/ files are left alone
     (public/ serves any that are kept). Until the DNS moves, this rule never
     matches, because those hosts still reach WordPress.
     Temporary (307) on purpose: browsers remember a permanent redirect for
     good, which would get in the way if the move ever had to be undone. */
  async redirects() {
    return OLD_HOSTS.map(host => ({
      source: "/:path((?!wp-content/uploads/).*)",
      has: [{ type: "host", value: host }],
      destination: "https://jarvis.cikoffice.com/",
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
