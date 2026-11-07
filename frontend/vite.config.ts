import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // pdf.js is ~640 kB and already split into its own lazy chunk.
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Override with API_TARGET=http://host:port when the backend runs elsewhere.
        target: process.env.API_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
