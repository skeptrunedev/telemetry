// skcal.fit edge worker: serves the Astro landing site from static assets and
// reverse-proxies /docs* to the Mintlify deployment so the docs live at
// skcal.fit/docs (Mintlify's documented subdirectory setup).
const DOCS_HOST = "sk-2131079b.mintlify.site";

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url);
    // docs.skcal.fit is a legacy/convenience hostname: permanently redirect
    // into the canonical /docs subdirectory on the apex.
    if (url.hostname === "docs.skcal.fit") {
      const path = url.pathname === "/" ? "" : url.pathname;
      return Response.redirect(
        `https://skcal.fit/docs${path}${url.search}`,
        301,
      );
    }
    if (url.pathname === "/docs" || url.pathname.startsWith("/docs/")) {
      const proxyUrl = new URL(request.url);
      proxyUrl.hostname = DOCS_HOST;
      const proxyRequest = new Request(proxyUrl, request);
      proxyRequest.headers.set("Host", DOCS_HOST);
      proxyRequest.headers.set("X-Forwarded-Host", url.hostname);
      proxyRequest.headers.set("X-Forwarded-Proto", "https");
      return fetch(proxyRequest);
    }
    return env.ASSETS.fetch(request);
  },
};
