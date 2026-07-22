import { useState, useEffect, useRef } from 'react'
import { Mic, Play, Pause, Download, RefreshCw, Volume2, ChevronDown, Loader, CheckCircle, AlertCircle, Music } from 'lucide-react'

const MODELS = [
  { id: 'eleven_flash_v2_5',        label: 'Flash 2.5',       desc: 'Fastest · lowest latency' },
  { id: 'eleven_turbo_v2_5',        label: 'Turbo 2.5',       desc: 'Fast + great quality ⭐' },
  { id: 'eleven_multilingual_v2',   label: 'Multilingual v2', desc: 'Best quality · all languages' },
]

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, hint }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        <span className="text-xs text-slate-500 font-mono">{value.toFixed(2)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-purple-500 bg-slate-700"
      />
      {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
    </div>
  )
}

function AudioPlayer({ url, label, onDownload }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef(null)

  useEffect(() => {
    setPlaying(false)
    setProgress(0)
  }, [url])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { a.play(); setPlaying(true) }
  }

  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music size={14} className="text-purple-400" />
          <span className="text-xs text-slate-300 font-medium truncate max-w-[160px]">{label}</span>
        </div>
        <button
          onClick={onDownload}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-purple-300 transition-colors px-2 py-1 rounded-lg hover:bg-slate-700"
        >
          <Download size={12} /> Download
        </button>
      </div>

      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={e => setProgress(e.target.currentTime)}
        onLoadedMetadata={e => setDuration(e.target.duration)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
      />

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-full bg-purple-600 hover:bg-purple-500 flex items-center justify-center transition-colors flex-shrink-0"
        >
          {playing ? <Pause size={14} className="text-white" /> : <Play size={14} className="text-white ml-0.5" />}
        </button>
        <div className="flex-1 flex flex-col gap-1">
          <div
            className="w-full h-1.5 bg-slate-700 rounded-full cursor-pointer relative"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = (e.clientX - rect.left) / rect.width
              if (audioRef.current) { audioRef.current.currentTime = pct * duration }
            }}
          >
            <div
              className="h-full bg-purple-500 rounded-full transition-all"
              style={{ width: duration ? `${(progress / duration) * 100}%` : '0%' }}
            />
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-slate-600 font-mono">{fmt(progress)}</span>
            <span className="text-[10px] text-slate-600 font-mono">{fmt(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function VoiceStudioPage() {
  const [voices, setVoices]       = useState([])
  const [voicesErr, setVoicesErr] = useState('')
  const [loadingVoices, setLoadingVoices] = useState(true)
  const [search, setSearch]       = useState('')

  const [selectedVoice, setSelectedVoice] = useState(null)
  const [text, setText]           = useState('')
  const [model, setModel]         = useState('eleven_turbo_v2_5')
  const [stability, setStability] = useState(0.5)
  const [similarity, setSimilarity] = useState(0.75)
  const [style, setStyle]         = useState(0.0)

  const [generating, setGenerating] = useState(false)
  const [genErr, setGenErr]       = useState('')
  const [history, setHistory]     = useState([]) // [{url, label, blob}]

  const baseUrl = window.location.origin

  useEffect(() => {
    fetch(`${baseUrl}/api/studio/voices`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setVoicesErr(d.error); setLoadingVoices(false); return }
        setVoices(d.voices || [])
        if (d.voices?.length) setSelectedVoice(d.voices[0])
        setLoadingVoices(false)
      })
      .catch(e => { setVoicesErr(e.message); setLoadingVoices(false) })
  }, [baseUrl])

  const filtered = voices.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.labels?.accent || '').toLowerCase().includes(search.toLowerCase()) ||
    (v.labels?.gender || '').toLowerCase().includes(search.toLowerCase())
  )

  const generate = async () => {
    if (!text.trim()) return
    if (!selectedVoice) return
    setGenerating(true)
    setGenErr('')
    try {
      const r = await fetch(`${baseUrl}/api/studio/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId: selectedVoice.voice_id, modelId: model, stability, similarity, style })
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setGenErr(d.error || 'Generation failed')
        setGenerating(false)
        return
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const label = `${selectedVoice.name} · ${text.slice(0, 30)}${text.length > 30 ? '…' : ''}`
      setHistory(prev => [{ url, blob, label, ts: Date.now() }, ...prev.slice(0, 9)])
    } catch (e) {
      setGenErr(e.message)
    }
    setGenerating(false)
  }

  const download = (item) => {
    const a = document.createElement('a')
    a.href = item.url
    a.download = `mfg-studio-${item.ts}.mp3`
    a.click()
  }

  const charCount = text.length
  const charLimit = 2500

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 sticky top-0 bg-slate-950/95 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.history.back()}
              className="text-slate-500 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            >←</button>
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <Mic size={15} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">MFG Voice Studio</h1>
              <p className="text-xs text-slate-500">Powered by ElevenLabs</p>
            </div>
          </div>
          <a
            href="https://elevenlabs.io/creative"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
          >
            ElevenCreative ↗
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* LEFT — Voice picker + Text input */}
          <div className="flex flex-col gap-6">

            {/* Voice picker */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Voice</h2>
                {loadingVoices && <Loader size={14} className="text-purple-400 animate-spin" />}
                {!loadingVoices && !voicesErr && (
                  <span className="text-xs text-slate-600">{voices.length} voices</span>
                )}
              </div>

              {voicesErr && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
                  <AlertCircle size={13} /> {voicesErr}
                </div>
              )}

              {!voicesErr && (
                <>
                  <input
                    type="text"
                    placeholder="Search voices…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                  <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                    {loadingVoices ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-12 bg-slate-800/60 rounded-lg animate-pulse" />
                      ))
                    ) : filtered.length === 0 ? (
                      <p className="text-xs text-slate-600 text-center py-4">No voices found</p>
                    ) : (
                      filtered.map(v => {
                        const isSelected = selectedVoice?.voice_id === v.voice_id
                        return (
                          <button
                            key={v.voice_id}
                            onClick={() => setSelectedVoice(v)}
                            className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all border ${
                              isSelected
                                ? 'border-purple-500 bg-purple-500/10 text-purple-200'
                                : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm ${isSelected ? 'bg-purple-600' : 'bg-slate-700'}`}>
                                {v.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-xs font-medium leading-tight">{v.name}</p>
                                <p className="text-[10px] text-slate-500 capitalize">
                                  {[v.labels?.gender, v.labels?.accent, v.labels?.use_case].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                            </div>
                            {isSelected && <CheckCircle size={13} className="text-purple-400 flex-shrink-0" />}
                          </button>
                        )
                      })
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Text input */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Text</h2>
                <span className={`text-xs font-mono ${charCount > charLimit * 0.9 ? 'text-red-400' : 'text-slate-600'}`}>
                  {charCount}/{charLimit}
                </span>
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value.slice(0, charLimit))}
                placeholder="Type anything — your bot will say it in the selected voice…"
                rows={6}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500 transition-colors resize-none"
              />
              {genErr && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
                  <AlertCircle size={13} /> {genErr}
                </div>
              )}
              <button
                onClick={generate}
                disabled={generating || !text.trim() || !selectedVoice}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
              >
                {generating
                  ? <><Loader size={14} className="animate-spin" /> Generating…</>
                  : <><Volume2 size={14} /> Generate Audio</>
                }
              </button>
            </div>
          </div>

          {/* RIGHT — Settings + History */}
          <div className="flex flex-col gap-6">

            {/* Settings */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-5">
              <h2 className="text-sm font-semibold text-slate-200">Settings</h2>

              {/* Model */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-slate-300">Model</label>
                <div className="grid grid-cols-1 gap-2">
                  {MODELS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all ${
                        model === m.id
                          ? 'border-purple-500 bg-purple-500/10'
                          : 'border-slate-700 bg-slate-800/40 hover:border-slate-600'
                      }`}
                    >
                      <div>
                        <p className={`text-xs font-medium ${model === m.id ? 'text-purple-200' : 'text-slate-300'}`}>{m.label}</p>
                        <p className="text-[10px] text-slate-500">{m.desc}</p>
                      </div>
                      {model === m.id && <div className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-slate-800" />

              {/* Sliders */}
              <div className="flex flex-col gap-4">
                <Slider
                  label="Stability"
                  value={stability}
                  onChange={setStability}
                  hint="Higher = more consistent. Lower = more expressive."
                />
                <Slider
                  label="Similarity"
                  value={similarity}
                  onChange={setSimilarity}
                  hint="How closely to clone the original voice."
                />
                <Slider
                  label="Style"
                  value={style}
                  onChange={setStyle}
                  hint="Adds more emotion. 0 = neutral, 1 = max style."
                />
              </div>

              <button
                onClick={() => { setStability(0.5); setSimilarity(0.75); setStyle(0.0) }}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors self-start"
              >
                <RefreshCw size={11} /> Reset defaults
              </button>
            </div>

            {/* History */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-200">Generated</h2>
                {history.length > 0 && (
                  <button
                    onClick={() => setHistory([])}
                    className="text-xs text-slate-600 hover:text-red-400 transition-colors"
                  >Clear</button>
                )}
              </div>
              {history.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center">
                    <Music size={18} className="text-slate-600" />
                  </div>
                  <p className="text-xs text-slate-600">Your generated clips will appear here</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {history.map(item => (
                    <AudioPlayer
                      key={item.ts}
                      url={item.url}
                      label={item.label}
                      onDownload={() => download(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
