import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ToastProvider } from './components/Toasts'

async function start() {
  if (import.meta.env.VITE_MOCK === '1') {
    const { installMockApi } = await import('./mock/mockApi')
    installMockApi()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>,
  )
}

start()
