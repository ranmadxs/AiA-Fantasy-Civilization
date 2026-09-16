import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  preview: { allowedHosts: true },
  build: { rollupOptions: { input: "./index.html" } },
  server: {
    // Dev en LAN: permite localhost, "nara" y cualquier IP local (el otro PC entra por IP).
    allowedHosts: true,
    fs: { allow: ["."] },
    watch: { ignored: ["**/target/**"] },
  },
});
