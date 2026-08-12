import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android シェルは NAS 上の本番 UI を WebView で開く。
 * Chrome の時間制限を避けつつ、中身の更新は今までどおり NAS 側だけで済む。
 *
 * CAPACITOR_SERVER_URL 例: https://kokuboke.tailXXXX.ts.net
 * ユーザー名はアプリ内（/）で覚える。ここにはホストだけを書く。
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.replace(/\/$/, '')

const config: CapacitorConfig = {
  appId: 'app.kokuboke',
  appName: 'kokuboke',
  webDir: 'dist/client',
  backgroundColor: '#0b0b0c',
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith('http://'),
      }
    : undefined,
  android: {
    allowMixedContent: false,
    backgroundColor: '#0b0b0c',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b0b0c',
    },
  },
}

export default config
