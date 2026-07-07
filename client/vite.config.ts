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
  build: {
    target: "es2020",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // React core
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router")
          ) {
            return "vendor-react";
          }

          // Markdown rendering pipeline (react-markdown + remark + rehype + syntax highlighting)
          if (
            id.includes("node_modules/react-markdown") ||
            id.includes("node_modules/remark-") ||
            id.includes("node_modules/rehype-") ||
            id.includes("node_modules/lowlight") ||
            id.includes("node_modules/highlight.js") ||
            id.includes("node_modules/hast-util-") ||
            id.includes("node_modules/mdast-util-") ||
            id.includes("node_modules/micromark") ||
            id.includes("node_modules/unified") ||
            id.includes("node_modules/unist-util-") ||
            id.includes("node_modules/property-information") ||
            id.includes("node_modules/space-separated-tokens") ||
            id.includes("node_modules/comma-separated-tokens") ||
            id.includes("node_modules/trim-lines") ||
            id.includes("node_modules/vfile") ||
            id.includes("node_modules/bail") ||
            id.includes("node_modules/is-plain-obj") ||
            id.includes("node_modules/trough") ||
            id.includes("node_modules/zwitch") ||
            id.includes("node_modules/ccount") ||
            id.includes("node_modules/longest-streak") ||
            id.includes("node_modules/markdown-table") ||
            id.includes("node_modules/decode-named-character-reference") ||
            id.includes("node_modules/character-entities") ||
            id.includes("node_modules/stringify-entities") ||
            id.includes("node_modules/html-void-elements") ||
            id.includes("node_modules/@ungap/structured-clone")
          ) {
            return "vendor-markdown";
          }

          // Monaco editor
          if (id.includes("node_modules/@monaco-editor")) {
            return "vendor-monaco";
          }

          // Icon library
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }

          // State management
          if (id.includes("node_modules/zustand")) {
            return "vendor-zustand";
          }

          // Catch-all for other small deps
          return "vendor";
        },
      },
    },
  },
});
