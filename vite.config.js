import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy /api/* to the deployed Cloudflare Worker so the frontend
// can talk to the real backend during local development.
// The build output still talks to the same origin in production.
// This is the PRODUCTION API (live D1, live Stripe) — the workers.dev host it
// used to point at is turned off (wrangler.toml workers_dev = false).
const WORKER_URL = 'https://airactionsport.com'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: WORKER_URL,
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
