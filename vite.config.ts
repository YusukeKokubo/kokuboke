import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const API_TARGET = 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Capacitor WebView では bridge 注入とぶつかるので、登録は main.tsx 側で分岐する。
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'kokuboke',
        short_name: 'kokuboke',
        description: '家族それぞれの AI と話すためのアプリ',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0b0c',
        theme_color: '#0b0b0c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリシェルだけをキャッシュする。会話ログと画像はオフライン対象にしない。
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // 数式まわり（KaTeX 本体とフォント）は重いうえ、使わない家庭も多い。
        // どのみち返答にはネットワークが要るので、必要になったときに取りに行く。
        globIgnores: ['**/KaTeX_*', '**/Math-*'],
        navigateFallbackDenylist: [/^\/api/, /^\/media/],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '~': path.resolve(import.meta.dirname, 'server'),
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/media': { target: API_TARGET, changeOrigin: true },
    },
  },
})
