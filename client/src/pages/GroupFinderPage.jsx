import { useState } from 'react'
import { Heart, Search, ExternalLink, Shield, AlertTriangle, ChevronLeft, Loader, Send, MessageCircle, Hash } from 'lucide-react'

const CATEGORIES = [
  { id:'dating',   label:'💕 Dating',       q:'dating singles romantic' },
  { id:'30plus',   label:'30+ Singles',     q:'singles 30 40 50 mature adults' },
  { id:'social',   label:'💬 Social Chat',  q:'social chat friends hangout' },
  { id:'usa',      label:'🇺🇸 USA Only',    q:'usa america united states group' },
  { id:'serious',  label:'💍 Serious',      q:'serious relationship marriage' },
]

const PLATFORM_ICONS = {
  telegram: { icon: Send,          label: 'Telegram',  color: 'text-sky-400',   bg: 'bg-sky-950/50 border-sky-700/40' },
  discord:  { icon: Hash,          label: 'Discord',   color: 'text-indigo-400',bg: 'bg-indigo-950/50 border-indigo-700/40' },
  whatsapp: { icon: MessageCircle, label: 'WhatsApp',  color: 'text-emerald-400',bg: 'bg-emerald-950/50 border-emerald-700/40' },
}

function PlatformBadge({ platform }) {
  const p = PLATFORM_ICONS[platform] || PLATFORM_ICONS.telegram
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${p.bg} ${p.color}`}>
      <p.icon size={9} /> {p.label}
    </span>
  )
}

function ResultCard({ result }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800/60 hover:border-slate-600/60 rounded-xl p-4 transition-all group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <PlatformBadge platform={result.platform} />
            {result.verified && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/30 border border-emerald-700/30 px-2 py-0.5 rounded-full">
                <Shield size={8} /> PUBLIC
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-slate-100 group-hover:text-cyan-300 transition-colors truncate">{result.title}</p>
          {result.description && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{result.description}</p>
          )}
        </div>
        <a href={result.url} target="_blank" rel="noreferrer"
          className="flex-shrink-0 flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 text-slate-300 text-xs font-mono px-3 py-2 rounded-lg transition-all">
          JOIN <ExternalLink size={10} />
        </a>
      </div>
    </div>
  )
}

export default function GroupFinderPage() {
  const [query, setQuery]         = useState('')
  const [platform, setPlatform]   = useState('all')
  const [category, setCategory]   = useState('')
  const [results, setResults]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const search = async () => {
    setLoading(true); setError(''); setResults(null)
    try {
      const q = [query, category ? CATEGORIES.find(c=>c.id===category)?.q : ''].filter(Boolean).join(' ') || 'dating singles usa'
      const params = new URLSearchParams({ q, platform })
      const res = await fetch(`/api/groups/search?${params}`)
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      setResults(data.results || [])
    } catch (e) {
      setError('Search failed — try again in a moment.')
    }
    setLoading(false)
  }

  const platforms = [
    { id:'all',      label:'All Platforms' },
    { id:'telegram', label:'📨 Telegram' },
    { id:'discord',  label:'🎮 Discord' },
    { id:'whatsapp', label:'💬 WhatsApp' },
  ]

  return (
    <div className="min-h-screen cyber-bg">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-pink-500/50 to-transparent" />

      {/* Header */}
      <header className="border-b border-slate-800/40 bg-slate-950/70 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => window.history.back()}
            className="text-slate-400 hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-800 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Heart size={14} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black text-slate-100 tracking-wide font-mono">GROUP FINDER</h1>
            <p className="text-[10px] text-pink-500 font-mono tracking-wider">SOCIAL · DATING · CONNECTIONS</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* Safety disclaimer */}
        <div className="bg-amber-950/20 border border-amber-700/30 rounded-xl p-4 flex gap-3">
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300/80 space-y-1">
            <p className="font-semibold text-amber-300">Stay Safe — Read Before Joining</p>
            <p>These are publicly listed groups from open directories. <span className="text-amber-200">Always verify a group yourself before sharing personal info.</span> Age ranges and legitimacy cannot be machine-verified — use your judgment. Never send money to strangers online.</p>
          </div>
        </div>

        {/* Search box */}
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-5 space-y-4">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="e.g. singles 30s 40s usa dating chat..."
              className="w-full bg-slate-950/60 border border-slate-700/60 focus:border-pink-600/60 rounded-lg pl-9 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none transition-colors"
            />
          </div>

          {/* Platform filter */}
          <div>
            <p className="text-[10px] text-slate-500 font-mono tracking-widest mb-2">PLATFORM</p>
            <div className="flex flex-wrap gap-2">
              {platforms.map(p => (
                <button key={p.id} onClick={() => setPlatform(p.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-mono transition-all
                    ${platform === p.id
                      ? 'bg-pink-600/20 border-pink-500/50 text-pink-300'
                      : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-500'}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Category filter */}
          <div>
            <p className="text-[10px] text-slate-500 font-mono tracking-widest mb-2">CATEGORY</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(c => (
                <button key={c.id} onClick={() => setCategory(prev => prev === c.id ? '' : c.id)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-mono transition-all
                    ${category === c.id
                      ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                      : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:border-slate-500'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={search} disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-pink-600/20 hover:bg-pink-600/30 border border-pink-600/40 hover:border-pink-500/60 text-pink-300 font-mono font-semibold py-3 rounded-lg transition-all tracking-wider disabled:opacity-50">
            {loading ? <><Loader size={14} className="animate-spin" /> SEARCHING…</> : <><Search size={14} /> FIND GROUPS</>}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-950/20 border border-red-700/30 rounded-lg px-4 py-3 text-xs text-red-400 font-mono">
            ❌ {error}
          </div>
        )}

        {/* Results */}
        {results !== null && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-800" />
              <span className="text-[10px] text-slate-500 font-mono tracking-widest">
                {results.length} GROUPS FOUND
              </span>
              <div className="h-px flex-1 bg-slate-800" />
            </div>

            {results.length === 0 ? (
              <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-8 text-center">
                <Heart size={28} className="text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No groups found for this search.</p>
                <p className="text-xs text-slate-600 mt-1">Try different keywords or a broader category.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {results.map((r, i) => <ResultCard key={i} result={r} />)}
              </div>
            )}

            <div className="bg-slate-900/30 border border-slate-800/40 rounded-xl p-4 text-xs text-slate-500 space-y-1">
              <p className="text-slate-400 font-semibold">💡 Tips for finding real connections</p>
              <p>• Look for groups with active pinned messages and regular posts — inactive groups are usually dead</p>
              <p>• Telegram groups with 200–5000 members tend to be more manageable than massive ones</p>
              <p>• Discord servers with #rules and #introduction channels are usually more organized</p>
              <p>• Leave any group that immediately asks for money or personal photos</p>
            </div>
          </div>
        )}

        {/* No search yet — helpful links */}
        {results === null && !loading && (
          <div className="space-y-3">
            <p className="text-[11px] text-slate-600 font-mono text-center tracking-wider">POPULAR SEARCHES</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label:'🇺🇸 USA Singles 30-50', q:'singles usa 30 40 50', cat:'30plus', plat:'telegram' },
                { label:'💕 Serious Dating',     q:'serious dating relationship', cat:'serious', plat:'all' },
                { label:'💬 Social Chat USA',    q:'friends social chat hangout usa', cat:'social', plat:'discord' },
                { label:'✨ Mature Adults',      q:'mature adults 40 50 60 social', cat:'30plus', plat:'all' },
              ].map(s => (
                <button key={s.label} onClick={() => { setQuery(s.q); setCategory(s.cat); setPlatform(s.plat); }}
                  className="bg-slate-900/40 border border-slate-800/60 hover:border-pink-600/30 rounded-xl p-3 text-left text-xs text-slate-400 hover:text-slate-200 transition-all font-mono">
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
