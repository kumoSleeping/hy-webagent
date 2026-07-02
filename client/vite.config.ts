import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all interfaces so phones/tablets on the same LAN can connect.
    host: true,
    port: 5173,
    // Vite 6+ blocks unknown Host headers by default — allow LAN IPs.
    allowedHosts: true,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/ws": {
        target: "ws://127.0.0.1:3001",
        ws: true,
      },
    },
  },
});
