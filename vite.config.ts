import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    cors: { origin: ["https://www.owlbear.rodeo", "https://owlbear.rodeo"] },
  },
  build: {
    rollupOptions: { input: { home: "index.html", panel: "panel.html" } },
  },
});
