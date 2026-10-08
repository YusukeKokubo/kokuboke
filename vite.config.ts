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
      // 前段に Cloudflare Access を置くと、manifest も cookie 付きで頼まないと
      // ログインの画面へ飛ばされて読めない（ホーム画面に追加できなくなる）。
      useCredentials: true,
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
        // 新しい sw.js を待機させず、その場で交代させる。
        // registerType: 'autoUpdate' なら普通はプラグインが勝手に付けるが、
        // それは injectRegister が auto のときだけ。こちらは false にしている
        // （Capacitor と衝突するため）ので、自分で書く必要がある。
        // 無いと、新しい版は installed のまま待機し、アプリを完全に閉じるまで
        // 古い画面が残る。古い画面はもう無いファイル名を頼むので 404 になる。
        skipWaiting: true,
        clientsClaim: true,
        // アプリシェルだけをキャッシュする。会話ログと画像はオフライン対象にしない。
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // 数式まわり（KaTeX 本体とフォント）は重いうえ、使わない家庭も多い。
        // どのみち返答にはネットワークが要るので、必要になったときに取りに行く。
        globIgnores: ['**/KaTeX_*', '**/Math-*'],
        // /login は前段のログインへ抜ける口なので、手元の index.html で受けない。
        navigateFallbackDenylist: [/^\/api/, /^\/media/, /^\/login/],
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
