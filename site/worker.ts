// skcal.fit edge worker: serves the Astro landing site from static assets and
// reverse-proxies /docs* to the Mintlify deployment so the docs live at
// skcal.fit/docs (Mintlify's documented subdirectory setup).
const DOCS_HOST = "sk-2131079b.mintlify.site";

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url);
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
