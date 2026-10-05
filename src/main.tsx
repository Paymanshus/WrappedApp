import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadDisplayFont } from './lib/fonts'
import App from './App.tsx'

loadDisplayFont()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// offline support: sw.js is emitted by the build only (see vite.config.ts)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
