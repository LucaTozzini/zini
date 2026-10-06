import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
})
