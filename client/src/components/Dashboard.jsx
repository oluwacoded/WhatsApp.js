import { useState } from 'react'
import { Plus, X, Wifi, WifiOff, Loader, ChevronRight, Bot, Zap } from 'lucide-react'
import { useBotStatus } from '../hooks/useBotApi'

function BotCard({ bot, onOpen, onRemove }) {
  const { status, loading, error } = useBotStatus(bot)

  const isOnline = !!status?.connected
  const hasQr = !!status?.hasQr

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 hover:border-blue-600/40 transition-all duration-200 group">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isOnline ? 'bg-blue-600/20' : 'bg-slate-800'}`}>
            <Bot size={18} className={isOnline ? 'text-blue-400' : 'text-slate-500'} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-100 text-sm">{bot.name}</h3>
            <p className="text-xs text-slate-500 truncate max-w-[160px]">
              {bot.isLocal ? 'localhost' : bot.url.replace('https://', '')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader size={14} className="text-slate-500 animate-spin" />
          ) : error ? (
            <span className="flex items-center gap-1 text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
              <WifiOff size={10} /> Offline
            </span>
          ) : isOnline ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
              <Wifi size={10} /> Online
            </span>
          ) : hasQr ? (
            <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">
              <Loader size={10} className="animate-spin" /> QR Ready
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
              <WifiOff size={10} /> Disconnected
            </span>
          )}
          {!bot.isLocal && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(bot.id) }}
              className="text-slate-600 hover:text-red-400 transition-colors p-1 rounded"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {status && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-slate-500">Messages</p>
            <p className="text-sm font-bold text-slate-200">{status.messageCount ?? '—'}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-slate-500">Chats</p>
            <p className="text-sm font-bold text-slate-200">{status.chatCount ?? '—'}</p>
          </div>
          <div className="bg-slate-800/60 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-slate-500">AI</p>
            <p className={`text-sm font-bold ${status.aiEnabled ? 'text-blue-400' : 'text-slate-500'}`}>
              {status.aiEnabled ? 'ON' : 'OFF'}
            </p>
          </div>
        </div>
      )}

      <button
        onClick={() => onOpen(bot)}
        className="w-full bg-blue-600/10 hover:bg-blue-600/20 border border-blue-600/20 hover:border-blue-600/40 text-blue-400 text-sm font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-all duration-150"
      >
        Open Console <ChevronRight size={14} />
      </button>
    </div>
  )
}

function AddBotModal({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  const handle = (e) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    onAdd(name.trim(), url.trim().replace(/\/$/, ''))
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-slate-100">Add Bot Instance</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handle} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-medium">Bot Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Personal Twin"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block font-medium">Backend URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://your-bot.up.railway.app"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            Add Bot
          </button>
        </form>
      </div>
    </div>
  )
}

export default function Dashboard({ bots, onOpenBot, onAddBot, onRemoveBot }) {
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="min-h-screen bg-slate-950">
      {showAdd && <AddBotModal onAdd={onAddBot} onClose={() => setShowAdd(false)} />}

      {/* Header */}
      <header className="border-b border-slate-800/60 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-100 tracking-tight">MFG_bot Hub</h1>
              <p className="text-xs text-slate-500">Multi-instance WhatsApp manager</p>
            </div>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={14} /> Add Bot
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-100">Bot Instances</h2>
          <p className="text-sm text-slate-500 mt-1">{bots.length} instance{bots.length !== 1 ? 's' : ''} configured</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bots.map(bot => (
            <BotCard key={bot.id} bot={bot} onOpen={onOpenBot} onRemove={onRemoveBot} />
          ))}
        </div>
      </main>
    </div>
  )
}
