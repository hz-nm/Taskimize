import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app talks to the API through the relative path `/api`, which Vite proxies
// in dev. In the production image nginx proxies the same path, so no build-time
// API URL is baked into the bundle.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://backend:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
