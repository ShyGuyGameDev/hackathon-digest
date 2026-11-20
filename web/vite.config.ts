import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: "src/client",
  // SUPABASE_URL is set in Vercel without the VITE_ prefix; it isn't secret, so expose it to the client.
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ""),
  },
  publicDir: "../../public",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { proxy: { "/api": `http://localhost:${apiPort}` } },
});
