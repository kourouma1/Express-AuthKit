/**
 * Démarre une application Express sur un port temporaire et renvoie un petit
 * client basé sur `fetch`, sans dépendance de test HTTP supplémentaire.
 *
 * @param {import("express").Express} app
 */
export async function startServer(app) {
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", (error) => (error ? reject(error) : resolve(listening)));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    /**
     * @param {string} path
     * @param {{ method?: string, headers?: Record<string, string>, body?: unknown }} [init]
     */
    async request(path, init = {}) {
      const headers = { ...init.headers };
      let body;
      if (init.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(init.body);
      }
      const response = await fetch(baseUrl + path, { method: init.method ?? "GET", headers, body });
      const text = await response.text();
      const isJson = response.headers.get("content-type")?.includes("application/json");
      return { status: response.status, headers: response.headers, body: isJson ? JSON.parse(text) : text };
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}
