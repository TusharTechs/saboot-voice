import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  publicDir: "public",
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://localhost:8787", "/clips": "http://localhost:8787" } },
});
