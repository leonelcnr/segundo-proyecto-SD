import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo (npm run dev) las rutas del backend se reenvían al Express en :3000
const backend = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/login": backend, "/logout": backend, "/me": backend, "/stream": backend, "/api": backend },
  },
});
