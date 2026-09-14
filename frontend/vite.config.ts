import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in development, so the app never needs CORS and the Idempotency-Key
    // header is not treated as a cross-origin preflight.
    proxy: {
      "/products": "http://localhost:3000",
      "/metrics": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
