import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true, ws: true },
    },
  },
});
