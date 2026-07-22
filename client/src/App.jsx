import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import BotConsole from './components/BotConsole'
import GuestCallPage from './pages/GuestCallPage'
import VoiceChangerPage from './pages/VoiceChangerPage'
import VoiceStudioPage from './pages/VoiceStudioPage'
import './index.css'

const DEFAULT_BOTS = [
  { id: 'local', name: 'Local Bot', url: '', isLocal: true },
  { id: 'railway1', name: 'Railway Bot', url: 'https://whatsappjs-production-3797.up.railway.app', isLocal: false },
]

// Bots permanently removed — purge from localStorage on load
const REMOVED_IDS = new Set(['ladies', 'railway2', 'railway3'])
const REMOVED_URLS = new Set([
  'https://whatsappjs-production-6831.up.railway.app',
  'https://whatsappjs-production.up.railway.app',
  'https://whatsappjs-production-31c8.up.railway.app',
])

export default function App() {
  // Guest call page — render standalone, no auth needed
  if (window.location.pathname.startsWith('/guest/')) {
    return <GuestCallPage />
  }

  // Voice Studio page
  if (window.location.pathname === '/voice-studio') {
    return <VoiceStudioPage />
  }

  // Standalone voice changer page
  if (window.location.pathname === '/voice-changer') {
    return (
      <div className="min-h-screen bg-slate-950 p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => window.history.back()} className="text-slate-400 hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-800 transition-colors">←</button>
            <h1 className="text-base font-bold text-slate-100">MFG Voice Changer</h1>
          </div>
          <VoiceChangerPage standalone />
        </div>
      </div>
    )
  }

  return <MainApp />
}

function MainApp() {
  const [bots, setBots] = useState(() => {
    try {
      const stored = (JSON.parse(localStorage.getItem('mfg_bots')) || [])
        .filter(b => !REMOVED_IDS.has(b.id) && !REMOVED_URLS.has(b.url))
      const storedIds = new Set(stored.map(b => b.id))
      const missing = DEFAULT_BOTS.filter(b => !storedIds.has(b.id))
      return stored.length ? [...stored, ...missing] : DEFAULT_BOTS
    } catch { return DEFAULT_BOTS }
  })
  const [activeBot, setActiveBot] = useState(null)

  useEffect(() => {
    localStorage.setItem('mfg_bots', JSON.stringify(bots))
  }, [bots])

  const addBot = (name, url) => {
    const bot = { id: Date.now().toString(), name, url, isLocal: false }
    setBots(prev => [...prev, bot])
  }

  const removeBot = (id) => {
    setBots(prev => prev.filter(b => b.id !== id))
    if (activeBot?.id === id) setActiveBot(null)
  }

  if (activeBot) {
    return <BotConsole bot={activeBot} onBack={() => setActiveBot(null)} />
  }

  return <Dashboard bots={bots} onOpenBot={setActiveBot} onAddBot={addBot} onRemoveBot={removeBot} />
}
