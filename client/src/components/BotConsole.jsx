import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Wifi, WifiOff, Loader, RefreshCw, Save, Trash2, Radio, Zap, Settings, BookOpen, Link, ToggleLeft, ToggleRight, Send, AlertCircle, Phone, Mic } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBotStatus, useBotApi } from '../hooks/useBotApi'
import CallRoomPage from '../pages/CallRoomPage'
import VoiceChangerPage from '../pages/VoiceChangerPage'

const COMMANDS = [
  { cmd: '.ai on/off', desc: 'Toggle AI replies', category: 'AI' },
  { cmd: '.ai status', desc: 'Show AI status and mode', category: 'AI' },
  { cmd: '.ai mode smart/aggressive/chill', desc: 'Set AI personality mode', category: 'AI' },
  { cmd: '.ai prompt <text>', desc: 'Set or view system prompt', category: 'AI' },
  { cmd: '.ai reset', desc: 'Clear AI memory', category: 'AI' },
  { cmd: '.ai delay <sec>', desc: 'Set response delay in seconds', category: 'AI' },
  { cmd: '.learnme add <text>', desc: 'Store style sample for AI learning', category: 'Learning' },
  { cmd: '.learnme view', desc: 'View stored style samples', category: 'Learning' },
  { cmd: '.learnme clear', desc: 'Clear all style samples', category: 'Learning' },
  { cmd: '.learnme auto', desc: 'Enable auto-learning in this chat', category: 'Learning' },
  { cmd: '.style casual/formal/savage', desc: 'Set reply style for this chat', category: 'Learning' },
  { cmd: '.broadcast all <msg>', desc: 'Send to all DM chats (max 50)', category: 'Broadcast' },
  { cmd: '.broadcast group <msg>', desc: 'Send to all groups (max 20)', category: 'Broadcast' },
  { cmd: '.broadcast status', desc: 'Show available chat count', category: 'Broadcast' },
  { cmd: '.bot status', desc: 'Full bot status report', category: 'Bot Control' },
  { cmd: '.bot ping', desc: 'Latency check', category: 'Bot Control' },
  { cmd: '.bot uptime', desc: 'Show uptime in seconds', category: 'Bot Control' },
  { cmd: '.bot prefix <symbol>', desc: 'Change command prefix', category: 'Bot Control' },
  { cmd: '.vv <text>', desc: 'Send as view-once message', category: 'Messaging' },
  { cmd: '.send <number> <msg>', desc: 'Send message to a number', category: 'Messaging' },
  { cmd: '.site', desc: 'Share portfolio link', category: 'Messaging' },
  { cmd: '.stats', desc: 'Message and command stats', category: 'Stats' },
  { cmd: '.stats commands', desc: 'Top used commands', category: 'Stats' },
  { cmd: '.stats memory', desc: 'Memory usage', category: 'Stats' },
  { cmd: '.flip', desc: 'Flip a coin', category: 'Fun' },
  { cmd: '.roll', desc: 'Roll a dice', category: 'Fun' },
  { cmd: '.ping', desc: 'Ping the bot', category: 'Fun' },
  { cmd: '.menu', desc: 'Show command menu', category: 'Utility' },
  { cmd: '.help ai/broadcast', desc: 'Category-specific help', category: 'Utility' },
]

const CATEGORIES = ['All', ...new Set(COMMANDS.map(c => c.category))]

function Tab({ label, active, onClick, icon: Icon }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-150 ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

function Toggle({ value, onChange, label, desc }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-800">
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {desc && <p className="text-xs text-slate-500 mt-0.5">{desc}</p>}
      </div>
      <button onClick={() => onChange(!value)} className="transition-transform active:scale-95">
        {value
          ? <ToggleRight size={28} className="text-blue-400" />
          : <ToggleLeft size={28} className="text-slate-600" />
        }
      </button>
    </div>
  )
}

function ConnectivityTab({ bot }) {
  const { status, loading, error, refresh } = useBotStatus(bot)
  const { get, post } = useBotApi(bot)
  const [qr, setQr] = useState(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [linkMethod, setLinkMethod] = useState('qr') // 'qr' | 'phone'
  const [phone, setPhone] = useState('')
  const [pairCode, setPairCode] = useState(null)
  const [pairLoading, setPairLoading] = useState(false)
  const [pairError, setPairError] = useState(null)
  const [pairStep, setPairStep] = useState('')
  const [pairElapsed, setPairElapsed] = useState(0)
  const pairTimerRef = useRef(null)

  const fetchQr = async () => {
    setQrLoading(true)
    try { const d = await get('/api/qr'); setQr(d.qr) } catch { setQr(null) }
    finally { setQrLoading(false) }
  }

  const requestPairCode = async () => {
    const cleaned = phone.trim().replace(/[^0-9]/g, '')
    if (!cleaned || cleaned.length < 10) {
      setPairError('Enter your full number with country code, digits only (e.g. 2349012345678)')
      return
    }
    setPairLoading(true); setPairError(null); setPairCode(null); setPairElapsed(0)
    setPairStep('Restarting socket in pairing mode…')
    // Countdown timer
    pairTimerRef.current = setInterval(() => setPairElapsed(s => s + 1), 1000)
    try {
      const d = await post('/api/pair', { phone: cleaned }, { timeoutMs: 95000 })
      if (d.code) {
        setPairCode(d.code)
        setPairStep('Code ready!')
      } else {
        setPairError('Server returned no code. Try again.')
      }
    } catch (e) {
      const msg = e.message || ''
      if (msg.includes('already connected')) {
        setPairError('Bot is already connected to WhatsApp. Logout first, then try again.')
      } else if (msg.includes('already registered')) {
        setPairError('Session already registered. Logout first to re-pair.')
      } else if (msg.includes('Timed out')) {
        setPairError('Timed out — WhatsApp did not respond. Make sure your number is correct (with country code, no +) and try again.')
      } else {
        setPairError(msg || 'Failed to get code. Try logging out first, then retry.')
      }
    } finally {
      setPairLoading(false)
      clearInterval(pairTimerRef.current)
    }
  }

  useEffect(() => () => clearInterval(pairTimerRef.current), [])

  const handleLogout = async () => {
    if (!confirm('Logout and reset session?')) return
    setLogoutLoading(true)
    try { await post('/api/logout', {}); setQr(null); setPairCode(null); setTimeout(refresh, 2000) } catch (e) { alert(e.message) }
    finally { setLogoutLoading(false) }
  }

  useEffect(() => {
    if (status?.hasQr && linkMethod === 'qr') fetchQr()
  }, [status?.hasQr, linkMethod])

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader className="animate-spin text-blue-400" size={24} />
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Status cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Status', value: error ? 'Offline' : status?.connected ? 'Connected' : status?.hasQr ? 'Waiting QR' : 'Disconnected', color: error ? 'text-red-400' : status?.connected ? 'text-emerald-400' : 'text-yellow-400' },
          { label: 'Uptime', value: (status && status.uptime != null) ? `${status.uptime}s` : '—' },
          { label: 'Messages', value: status?.messageCount ?? '—' },
          { label: 'Chats', value: status?.chatCount ?? '—' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-800/60 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-base font-bold ${color || 'text-slate-100'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Link section */}
      {!status?.connected && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-6 space-y-4">
          {/* Method toggle */}
          <div className="flex items-center gap-2 p-1 bg-slate-800 rounded-lg w-fit">
            <button
              onClick={() => { setLinkMethod('qr'); setPairCode(null); setPairError(null) }}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${linkMethod === 'qr' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              QR Code
            </button>
            <button
              onClick={() => { setLinkMethod('phone'); setQr(null) }}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${linkMethod === 'phone' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Phone Number
            </button>
          </div>

          {linkMethod === 'qr' ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Scan QR Code</h3>
                <button onClick={fetchQr} disabled={qrLoading} className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                  <RefreshCw size={12} className={qrLoading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
              {qrLoading ? (
                <div className="flex items-center justify-center h-48"><Loader className="animate-spin text-blue-400" size={20} /></div>
              ) : qr ? (
                <div className="flex justify-center">
                  <div className="bg-white p-4 rounded-xl"><QRCodeSVG value={qr} size={200} /></div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-28 gap-3">
                  <AlertCircle size={22} className="text-slate-600" />
                  <p className="text-sm text-slate-500 text-center">No QR yet — bot is connecting.<br/>If scanning fails, try Phone Number method instead.</p>
                  <button onClick={fetchQr} className="text-xs text-blue-400 hover:underline">Check again</button>
                </div>
              )}
              <p className="text-xs text-slate-500 text-center">WhatsApp → Settings → Linked Devices → Link a Device</p>
            </>
          ) : (
            <>
              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-1">Link with Phone Number</h3>
                <p className="text-xs text-slate-500 mb-3">
                  Enter your number with country code (no + or spaces). The bot will generate an 8-digit code — enter it in WhatsApp → Settings → Linked Devices → Link with phone number.
                </p>
                <div className="text-xs text-slate-500 bg-slate-800/60 rounded-lg px-3 py-2 mb-3 space-y-0.5">
                  <p>🇳🇬 Nigeria example: <span className="text-slate-300 font-mono">2349012345678</span></p>
                  <p>🌍 Other countries: <span className="text-slate-300 font-mono">countrycode + number</span></p>
                </div>
                <div className="flex gap-2">
                  <input
                    value={phone}
                    onChange={e => { setPhone(e.target.value); setPairError(null) }}
                    onKeyDown={e => e.key === 'Enter' && !pairLoading && requestPairCode()}
                    placeholder="e.g. 2349132883869"
                    disabled={pairLoading}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors font-mono disabled:opacity-50"
                  />
                  <button
                    onClick={requestPairCode}
                    disabled={pairLoading || !phone.trim()}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors whitespace-nowrap flex items-center gap-2"
                  >
                    {pairLoading ? <><Loader size={14} className="animate-spin" /> Getting…</> : 'Get Code'}
                  </button>
                </div>

                {pairLoading && (
                  <div className="mt-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Loader size={13} className="animate-spin text-blue-400 shrink-0" />
                      <p className="text-xs text-blue-300 font-medium">{pairStep || 'Connecting to WhatsApp…'}</p>
                    </div>
                    <p className="text-xs text-slate-500 ml-5">Elapsed: {pairElapsed}s — please wait up to 90s</p>
                    {pairElapsed > 10 && pairElapsed < 30 && (
                      <p className="text-xs text-slate-500 ml-5 mt-1">🔄 Negotiating with WhatsApp servers…</p>
                    )}
                    {pairElapsed >= 30 && (
                      <p className="text-xs text-amber-400 ml-5 mt-1">⚠️ Taking longer than usual — Railway cold-start? Hang tight…</p>
                    )}
                  </div>
                )}

                {pairError && (
                  <div className="mt-3 flex items-start gap-2 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                    <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-red-400">{pairError}</p>
                      {pairError.includes('Logout') || pairError.includes('already') ? (
                        <button onClick={handleLogout} disabled={logoutLoading} className="mt-1.5 text-xs text-red-300 underline hover:text-red-200">
                          Logout now →
                        </button>
                      ) : (
                        <button onClick={requestPairCode} disabled={pairLoading} className="mt-1.5 text-xs text-blue-400 underline hover:text-blue-300">
                          Try again →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {pairCode && (
                  <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5 text-center">
                    <p className="text-xs text-slate-400 mb-3">✅ Code generated! Enter it in WhatsApp now:</p>
                    <p className="text-4xl font-bold tracking-[0.35em] text-emerald-400 font-mono select-all">{pairCode}</p>
                    <p className="text-xs text-slate-500 mt-3">WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number</p>
                    <p className="text-xs text-amber-400 mt-1">⏱ Expires in ~60 seconds</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {status?.connected && (
        <div className="bg-emerald-400/5 border border-emerald-400/20 rounded-xl p-4 flex items-center gap-3">
          <Wifi size={18} className="text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-400">WhatsApp Connected</p>
            <p className="text-xs text-slate-400 mt-0.5">Bot is active and receiving messages</p>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={refresh} className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
        <button onClick={handleLogout} disabled={logoutLoading} className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 px-4 py-2 rounded-lg transition-colors">
          <WifiOff size={14} /> {logoutLoading ? 'Resetting...' : 'Reset Session'}
        </button>
      </div>
    </div>
  )
}

function PersonalityTab({ bot }) {
  const { get, post, del } = useBotApi(bot)
  const [prompt, setPrompt] = useState('')
  const [samples, setSamples] = useState([])
  const [newSample, setNewSample] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    get('/api/settings').then(d => setPrompt(d.systemPrompt || '')).catch(() => {})
    get('/api/style').then(d => setSamples(d.samples || [])).catch(() => {})
  }, [])

  const savePrompt = async () => {
    setSaving(true)
    try {
      await post('/api/set-system-prompt', { prompt })
      setMsg('Prompt saved!')
      setTimeout(() => setMsg(''), 2000)
    } catch (e) { setMsg('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  const addSample = async () => {
    if (!newSample.trim()) return
    try {
      await post('/api/style', { sample: newSample.trim() })
      setSamples(prev => [...prev, newSample.trim()])
      setNewSample('')
    } catch (e) { alert(e.message) }
  }

  const clearSamples = async () => {
    if (!confirm('Clear all style samples?')) return
    try { await del('/api/style'); setSamples([]) } catch (e) { alert(e.message) }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-slate-200">System Prompt</label>
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
        </div>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={5}
          placeholder="Enter the AI personality/system prompt..."
          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors resize-none font-mono"
        />
        <button
          onClick={savePrompt}
          disabled={saving}
          className="mt-2 flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Save size={14} /> {saving ? 'Saving...' : 'Save Prompt'}
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-slate-200">Style Samples</h3>
            <p className="text-xs text-slate-500 mt-0.5">Teach the AI how you talk</p>
          </div>
          {samples.length > 0 && (
            <button
              onClick={clearSamples}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 size={12} /> Clear All
            </button>
          )}
        </div>
        <div className="flex gap-2 mb-3">
          <input
            value={newSample}
            onChange={e => setNewSample(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSample()}
            placeholder="Add a style sample..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={addSample}
            className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-2 rounded-lg transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {samples.slice(-10).reverse().map((s, i) => (
            <div key={i} className="bg-slate-800/60 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono">
              "{s}"
            </div>
          ))}
          {samples.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-4">No style samples yet. Add some to teach the AI your style.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function CommandsTab() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')

  const filtered = COMMANDS.filter(c => {
    const matchCat = category === 'All' || c.category === category
    const matchSearch = !search || c.cmd.includes(search.toLowerCase()) || c.desc.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search commands..."
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              category === cat
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {filtered.map((c, i) => (
          <div key={i} className="bg-slate-800/60 hover:bg-slate-800 rounded-lg px-4 py-3 flex items-center justify-between transition-colors group">
            <div>
              <code className="text-xs text-blue-400 font-mono">{c.cmd}</code>
              <p className="text-xs text-slate-500 mt-0.5">{c.desc}</p>
            </div>
            <span className="text-xs text-slate-600 bg-slate-700/50 px-2 py-0.5 rounded-full shrink-0 ml-3">
              {c.category}
            </span>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-slate-600 text-center py-8">No commands match your search.</p>
        )}
      </div>
    </div>
  )
}

function SettingsTab({ bot }) {
  const { get, post } = useBotApi(bot)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    get('/api/settings').then(d => { setSettings(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const update = (key, val) => setSettings(prev => ({ ...prev, [key]: val }))

  const save = async () => {
    setSaving(true)
    try {
      await post('/api/settings', settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-8"><Loader className="animate-spin text-blue-400" size={20} /></div>
  if (!settings) return <p className="text-sm text-slate-500 text-center py-8">Could not load settings from this bot.</p>

  return (
    <div className="space-y-1">
      <Toggle value={settings.aiEnabled} onChange={v => update('aiEnabled', v)} label="AI Replies" desc="Auto-respond using Groq AI" />
      <Toggle value={settings.autoCallReject} onChange={v => update('autoCallReject', v)} label="Auto-Reject Calls" desc="Automatically reject incoming calls" />
      <Toggle value={settings.autoReadStatus} onChange={v => update('autoReadStatus', v)} label="Auto-Read Status" desc="Mark status updates as seen" />
      <Toggle value={settings.aiTyping} onChange={v => update('aiTyping', v)} label="Typing Indicator" desc="Show typing... before AI reply" />

      <div className="pt-4 space-y-4">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">AI Mode</label>
          <select
            value={settings.aiMode}
            onChange={e => update('aiMode', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="smart">Smart</option>
            <option value="aggressive">Aggressive</option>
            <option value="chill">Chill</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Command Prefix</label>
          <input
            value={settings.prefix}
            onChange={e => update('prefix', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">AI Reply Delay (seconds)</label>
          <input
            type="number" min="0" max="30"
            value={settings.aiDelay}
            onChange={e => update('aiDelay', parseInt(e.target.value) || 0)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="pt-4">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          <Save size={14} /> {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

function FakeCallTab() {
  const [room, setRoom] = useState(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState(null)

  const startCall = async () => {
    setCreating(true); setErr(null)
    try {
      const r = await fetch('/api/call/rooms', { method: 'POST' })
      if (!r.ok) throw new Error('Server error — is the bot running?')
      setRoom(await r.json())
    } catch (e) { setErr(e.message) }
    finally { setCreating(false) }
  }

  if (room) {
    return (
      <div className="-mx-6 -mt-6" style={{ height: 'calc(100vh - 130px)' }}>
        <CallRoomPage code={room.code} onLeave={() => setRoom(null)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
      <div className="w-20 h-20 rounded-full bg-purple-900/30 border border-purple-700/50 flex items-center justify-center">
        <Phone size={32} className="text-purple-400" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-slate-100 mb-2">Private Voice Call</h2>
        <p className="text-sm text-slate-400 max-w-sm mx-auto leading-relaxed">
          Start a call room, copy the guest link, and share it however you like.
          You pick your AI voice here — the other person just hears you speak normally.
        </p>
      </div>
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4 max-w-sm w-full text-left space-y-2">
        <p className="text-xs font-semibold text-slate-300 mb-3">How it works</p>
        {[
          ['1', 'Click Start New Call below'],
          ['2', 'Copy the guest link that appears'],
          ['3', 'Share the link to the person you want to call'],
          ['4', 'Pick your AI voice (natural, deep male, celebrity, etc.)'],
          ['5', 'They open the link — you\'re live'],
        ].map(([n, t]) => (
          <div key={n} className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-purple-700/60 text-purple-300 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
            <p className="text-xs text-slate-400">{t}</p>
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-400 bg-red-400/10 px-4 py-2 rounded-lg">{err}</p>}
      <button
        onClick={startCall}
        disabled={creating}
        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-xl transition-colors shadow-[0_0_24px_rgba(147,51,234,0.35)]"
      >
        <Phone size={16} />
        {creating ? 'Starting…' : 'Start New Call'}
      </button>
      <p className="text-xs text-slate-600">WebRTC · ElevenLabs AI voice</p>
    </div>
  )
}

const TABS = [
  { id: 'connectivity', label: 'Connectivity', icon: Link },
  { id: 'personality', label: 'Personality', icon: Zap },
  { id: 'commands', label: 'Commands', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'vcall', label: 'Fake Call', icon: Phone },
  { id: 'vchange', label: 'Voice Changer', icon: Mic },
]

export default function BotConsole({ bot, onBack }) {
  const [tab, setTab] = useState('connectivity')
  const { status, error } = useBotStatus(bot)

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800/60 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-slate-400 hover:text-slate-100 transition-colors p-1.5 rounded-lg hover:bg-slate-800"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-100">{bot.name}</h1>
                {error ? (
                  <span className="flex items-center gap-1 text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                    <WifiOff size={10} /> Offline
                  </span>
                ) : status?.connected ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                    <Wifi size={10} /> Online
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">
                    <Loader size={10} className="animate-spin" /> Connecting
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">{bot.isLocal ? 'Local instance' : bot.url}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-slate-800/60 px-6">
        <div className="max-w-4xl mx-auto flex gap-1 py-2 overflow-x-auto">
          {TABS.map(t => (
            <Tab key={t.id} label={t.label} active={tab === t.id} onClick={() => setTab(t.id)} icon={t.icon} />
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-6">
        {tab === 'connectivity' && <ConnectivityTab bot={bot} />}
        {tab === 'personality' && <PersonalityTab bot={bot} />}
        {tab === 'commands' && <CommandsTab />}
        {tab === 'settings' && <SettingsTab bot={bot} />}
        {tab === 'vcall' && <FakeCallTab />}
        {tab === 'vchange' && <VoiceChangerPage />}
      </main>
    </div>
  )
}
