import { useState } from 'react'
import { Plus, X, Wifi, WifiOff, Loader, Bot, Zap, Mic, Heart, ChevronRight, Terminal, Shield, Activity } from 'lucide-react'
import { useBotStatus } from '../hooks/useBotApi'

function StatusBadge({ loading, error, isOnline, hasQr }) {
  if (loading) return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded-full border border-slate-700/50 font-mono">
      <Loader size={9} className="animate-spin text-cyan-400" /> SCANNING
    </span>
  )
  if (error) return (
    <span className="flex items-center gap-1.5 text-[11px] text-red-400 bg-red-950/40 px-2.5 py-1 rounded-full border border-red-800/40 font-mono">
      <WifiOff size={9} /> OFFLINE
    </span>
  )
  if (isOnline) return (
    <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-700/40 font-mono pulse-green">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" /> ONLINE
    </span>
  )
  if (hasQr) return (
    <span className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-700/40 font-mono">
      <Loader size={9} className="animate-spin" /> QR READY
    </span>
  )
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-900 px-2.5 py-1 rounded-full border border-slate-800 font-mono">
      <WifiOff size={9} /> IDLE
    </span>
  )
}

function BotCard({ bot, onOpen, onRemove }) {
  const { status, loading, error } = useBotStatus(bot)
  const isOnline = !!status?.connected
  const hasQr    = !!status?.hasQr

  return (
    <div className={`card-cyber bg-slate-900/60 backdrop-blur-sm border rounded-xl p-5 flex flex-col gap-4 cursor-pointer group
      ${isOnline ? 'border-emerald-700/30 hover:border-emerald-500/50 hover:glow-green' : 'border-slate-800/60 hover:border-cyan-700/40'}`}
      onClick={() => onOpen(bot)}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center border
            ${isOnline
              ? 'bg-emerald-950/60 border-emerald-700/40 group-hover:border-emerald-500/60'
              : 'bg-slate-800/60 border-slate-700/40 group-hover:border-cyan-700/40'}`}>
            <Bot size={18} className={isOnline ? 'text-emerald-400' : 'text-slate-500 group-hover:text-cyan-400'} />
          </div>
          <div>
            <h3 className="font-bold text-slate-100 text-sm tracking-wide">{bot.name}</h3>
            <p className="text-[11px] text-slate-500 font-mono truncate max-w-[150px]">
              {bot.isLocal ? 'localhost:5000' : bot.url.replace('https://', '')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge loading={loading} error={error} isOnline={isOnline} hasQr={hasQr} />
          {!bot.isLocal && (
            <button onClick={e => { e.stopPropagation(); onRemove(bot.id) }}
              className="text-slate-700 hover:text-red-400 transition-colors p-1 rounded ml-1">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {status && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'MESSAGES', val: status.messageCount ?? '—' },
            { label: 'CHATS',    val: status.chatCount    ?? '—' },
            { label: 'AI',       val: status.aiEnabled ? 'ON' : 'OFF', color: status.aiEnabled ? 'text-cyan-400' : 'text-slate-600' },
          ].map(({ label, val, color }) => (
            <div key={label} className="bg-slate-950/60 border border-slate-800/60 rounded-lg px-2 py-2 text-center">
              <p className="text-[9px] text-slate-600 font-mono tracking-wider">{label}</p>
              <p className={`text-sm font-bold font-mono mt-0.5 ${color || 'text-slate-200'}`}>{val}</p>
            </div>
          ))}
        </div>
      )}

      <button className={`w-full border text-xs font-mono font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all duration-150 tracking-wider
        ${isOnline
          ? 'bg-emerald-950/30 hover:bg-emerald-900/40 border-emerald-700/30 hover:border-emerald-500/50 text-emerald-400'
          : 'bg-cyan-950/20 hover:bg-cyan-900/30 border-cyan-800/20 hover:border-cyan-600/40 text-cyan-500 hover:text-cyan-300'}`}>
        <Terminal size={12} /> ACCESS TERMINAL
      </button>
    </div>
  )
}

function AddBotModal({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [url,  setUrl]  = useState('')

  const handle = e => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    onAdd(name.trim(), url.trim().replace(/\/$/, ''))
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900/95 border border-cyan-800/30 rounded-2xl w-full max-w-md p-6 glow-cyan">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-bold text-cyan-300 font-mono tracking-wide">// ADD BOT INSTANCE</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Link a remote backend to this hub</p>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-300 transition-colors p-1">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handle} className="flex flex-col gap-4">
          {[
            { label:'BOT_NAME', key:'name', val:name, set:setName, ph:'e.g. Personal Twin' },
            { label:'BACKEND_URL', key:'url', val:url, set:setUrl, ph:'https://your-bot.up.railway.app' },
          ].map(({ label, key, val, set, ph }) => (
            <div key={key}>
              <label className="text-[10px] text-cyan-600 mb-1.5 block font-mono tracking-widest">{label}</label>
              <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
                className="w-full bg-slate-950/60 border border-slate-700/60 focus:border-cyan-600/60 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-colors font-mono" />
            </div>
          ))}
          <button type="submit"
            className="bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-600/40 hover:border-cyan-500/60 text-cyan-300 font-mono font-semibold py-2.5 rounded-lg transition-all text-sm tracking-wider glow-cyan mt-1">
            DEPLOY INSTANCE
          </button>
        </form>
      </div>
    </div>
  )
}

const TOOLS = [
  { href:'/voice-studio', icon: Mic,      color:'purple', label:'Voice Studio',  sub:'Generate audio · ElevenLabs TTS',  glow:'glow-purple', border:'hover:border-purple-600/50', bg:'bg-purple-950/30',  iconBg:'bg-purple-950/60 border-purple-700/40',  iconColor:'text-purple-400' },
  { href:'/voice-changer',icon: Zap,      color:'cyan',   label:'Voice Changer', sub:'Real-time pitch shift · live calls', glow:'glow-cyan',   border:'hover:border-cyan-600/50',   bg:'bg-cyan-950/30',    iconBg:'bg-cyan-950/60 border-cyan-700/40',      iconColor:'text-cyan-400' },
  { href:'/group-finder', icon: Heart,    color:'pink',   label:'Group Finder',  sub:'Find dating & social groups · USA',  glow:'glow-pink',   border:'hover:border-pink-600/50',   bg:'bg-pink-950/30',    iconBg:'bg-pink-950/60 border-pink-700/40',      iconColor:'text-pink-400' },
]

export default function Dashboard({ bots, onOpenBot, onAddBot, onRemoveBot }) {
  const [showAdd, setShowAdd] = useState(false)
  const onlineCount = bots.filter(b => b._online).length

  return (
    <div className="min-h-screen cyber-bg">
      {showAdd && <AddBotModal onAdd={onAddBot} onClose={() => setShowAdd(false)} />}

      {/* Top gradient accent line */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />

      {/* Header */}
      <header className="border-b border-slate-800/40 bg-slate-950/70 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-lg flex items-center justify-center glow-cyan">
              <Zap size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black text-slate-100 tracking-widest font-mono flicker">MFG_BOT_HUB</h1>
              <p className="text-[10px] text-cyan-600 font-mono tracking-wider">MULTI-INSTANCE WHATSAPP MANAGER</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 bg-slate-900/60 border border-slate-800/60 px-3 py-1.5 rounded-full">
              <Activity size={10} className="text-cyan-400 animate-pulse" />
              <span className="text-[10px] text-slate-400 font-mono">{bots.length} BOTS LOADED</span>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-600/40 hover:border-cyan-500/60 text-cyan-300 text-xs font-mono font-semibold px-4 py-2 rounded-lg transition-all glow-cyan tracking-wider">
              <Plus size={13} /> NEW BOT
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">

        {/* Bot Instances */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px flex-1 bg-gradient-to-r from-cyan-500/30 to-transparent" />
            <div className="flex items-center gap-2">
              <Shield size={13} className="text-cyan-500" />
              <span className="text-[11px] font-mono text-cyan-500 tracking-widest">BOT INSTANCES</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-l from-cyan-500/30 to-transparent" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bots.map(bot => (
              <BotCard key={bot.id} bot={bot} onOpen={onOpenBot} onRemove={onRemoveBot} />
            ))}
          </div>
        </section>

        {/* Tools */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-px flex-1 bg-gradient-to-r from-purple-500/30 to-transparent" />
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-purple-500" />
              <span className="text-[11px] font-mono text-purple-500 tracking-widest">TOOLS &amp; MODULES</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-l from-purple-500/30 to-transparent" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TOOLS.map(t => (
              <a key={t.href} href={t.href}
                className={`card-cyber bg-slate-900/50 backdrop-blur-sm border border-slate-800/60 ${t.border} rounded-xl p-5 flex items-center gap-4 transition-all group no-underline`}>
                <div className={`w-11 h-11 ${t.iconBg} border rounded-xl flex items-center justify-center flex-shrink-0 transition-colors group-hover:${t.glow}`}>
                  <t.icon size={18} className={t.iconColor} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${t.iconColor} font-mono tracking-wide`}>{t.label}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">{t.sub}</p>
                </div>
                <ChevronRight size={14} className="text-slate-700 group-hover:text-slate-400 transition-colors flex-shrink-0" />
              </a>
            ))}
          </div>
        </section>

        {/* Footer */}
        <div className="text-center pt-4 pb-2">
          <p className="text-[10px] text-slate-700 font-mono tracking-widest">MFG_BOT_HUB v3.0 · NEURAL AI ACTIVE · GROQ + GEMINI</p>
        </div>

      </main>
    </div>
  )
}
