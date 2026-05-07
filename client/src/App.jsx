import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import BotConsole from './components/BotConsole'
import './index.css'

const DEFAULT_BOTS = [
  { id: 'local', name: 'Local Bot', url: '', isLocal: true },
  { id: 'railway1', name: 'Railway Bot 1', url: 'https://whatsappjs-production-6831.up.railway.app', isLocal: false },
  { id: 'railway2', name: 'Railway Bot 2', url: 'https://whatsappjs-production.up.railway.app', isLocal: false },
  { id: 'railway3', name: 'Railway Bot 3', url: 'https://whatsappjs-production-31c8.up.railway.app', isLocal: false },
]

// Bots permanently removed — purge from localStorage on load
const REMOVED_IDS = new Set(['ladies'])
const REMOVED_URLS = new Set([])

export default function App() {
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
