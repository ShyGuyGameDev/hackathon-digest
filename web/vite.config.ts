import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { proxy: { "/api": `http://localhost:${apiPort}` } },
});
