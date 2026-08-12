import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { registerSW } from 'virtual:pwa-register'
import { rememberServiceWorker, watchForNewBuild } from '@/lib/refresh'
import './index.css'
import App from './App'

async function prepareNativeShell() {
  if (!Capacitor.isNativePlatform()) return
  try {
    await StatusBar.setStyle({ style: Style.Dark })
    await StatusBar.setBackgroundColor({ color: '#0b0b0c' })
  } catch {
    // プラグインが無い環境でも画面自体は動く。
  }
}

if (Capacitor.isNativePlatform()) {
  void prepareNativeShell()
} else {
  registerSW({
    immediate: true,
    onRegisteredSW: (_url, registration) => rememberServiceWorker(registration),
  })
}

watchForNewBuild()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
