import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/** Same /app → app.html routing as vercel.json, for dev + preview. */
function appRoutePlugin() {
  const rewrite = (req, _res, next) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url === "/app" || url.startsWith("/app/")) req.url = "/app.html";
    next();
  };
  return {
    name: "app-route",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

export default defineConfig({
  plugins: [react(), appRoutePlugin()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true, ws: true },
    },
  },
});
