import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy /api/* to the deployed Cloudflare Worker so the frontend
// can talk to the real backend during local development.
// The build output still talks to the same origin in production.
const WORKER_URL = 'https://air-action-sports.bulletbiter99.workers.dev'

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
