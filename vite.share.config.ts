import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: { outDir: "dist/share", emptyOutDir: true, sourcemap: false, rollupOptions: { input: "share.html" } },
});
