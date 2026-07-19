import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, Square, Play, Monitor, Smartphone, Volume2, ChevronDown } from 'lucide-react'

const VOICE_PRESETS = [
  { name: 'Natural',    pitch: 0,   emoji: '🎙️', color: 'slate',  desc: 'Your real voice' },
  { name: 'Girl',       pitch: 8,   emoji: '🌸', color: 'pink',   desc: 'Warm female voice' },
  { name: 'Young Girl', pitch: 12,  emoji: '✨', color: 'purple', desc: 'Higher, younger' },
  { name: 'Deep Male',  pitch: -5,  emoji: '🎭', color: 'blue',   desc: 'Low & authoritative' },
  { name: 'Old Man',    pitch: -8,  emoji: '👴', color: 'amber',  desc: 'Aged, gravelly' },
  { name: 'Alien',      pitch: 6,   emoji: '👽', color: 'green',  desc: 'Eerie, otherworldly' },
]

const COLOR = {
  slate:  { ring: 'ring-slate-500',  bg: 'bg-slate-700',   text: 'text-slate-300',  glow: '' },
  pink:   { ring: 'ring-pink-500',   bg: 'bg-pink-900/70', text: 'text-pink-300',   glow: 'shadow-[0_0_20px_rgba(236,72,153,0.4)]' },
  purple: { ring: 'ring-purple-500', bg: 'bg-purple-900/70',text: 'text-purple-300', glow: 'shadow-[0_0_20px_rgba(168,85,247,0.4)]' },
  blue:   { ring: 'ring-blue-500',   bg: 'bg-blue-900/70', text: 'text-blue-300',   glow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]' },
  amber:  { ring: 'ring-amber-500',  bg: 'bg-amber-900/70',text: 'text-amber-300',  glow: 'shadow-[0_0_20px_rgba(245,158,11,0.4)]' },
  green:  { ring: 'ring-green-500',  bg: 'bg-green-900/70',text: 'text-green-300',  glow: 'shadow-[0_0_20px_rgba(34,197,94,0.4)]' },
}

export default function VoiceChangerPage({ standalone = false }) {
  const [platform, setPlatform]         = useState('pc')
  const [inputDevices, setInputDevices] = useState([])
  const [outputDevices, setOutputDevices] = useState([])
  const [selectedInput, setSelectedInput]   = useState('')
  const [selectedOutput, setSelectedOutput] = useState('')
  const [preset, setPreset]             = useState(0)
  const [status, setStatus]             = useState('idle')   // idle|loading|running|error
  const [volume, setVolume]             = useState(0)
  const [muted, setMuted]               = useState(false)
  const [err, setErr]                   = useState('')
  const [sinkSupported, setSinkSupported] = useState(false)

  const toneRef    = useRef(null)
  const shiftRef   = useRef(null)
  const analyserRef = useRef(null)
  const animRef    = useRef(null)
  const mutedRef   = useRef(false)
  const gainRef    = useRef(null)

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then(devs => {
        setInputDevices(devs.filter(d => d.kind === 'audioinput'))
        const outs = devs.filter(d => d.kind === 'audiooutput')
        setOutputDevices(outs)
        setSinkSupported('setSinkId' in HTMLAudioElement.prototype)
      })
      .catch(() => setErr('Microphone permission denied. Allow mic access and refresh.'))
  }, [])

  const changePreset = useCallback((idx) => {
    setPreset(idx)
    if (shiftRef.current) shiftRef.current.pitch = VOICE_PRESETS[idx].pitch
  }, [])

  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    mutedRef.current = next
    if (gainRef.current) gainRef.current.gain.value = next ? 0 : 1
  }, [muted])

  const start = async () => {
    setStatus('loading'); setErr('')
    try {
      const Tone = await import('tone')
      await Tone.start()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInput ? { exact: selectedInput } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      })

      const rawCtx = Tone.getContext().rawContext

      // Route output to selected device (VB-Cable on PC)
      if (selectedOutput && rawCtx.setSinkId) {
        try { await rawCtx.setSinkId(selectedOutput) } catch {}
      }

      // Mic source
      const src = rawCtx.createMediaStreamSource(stream)

      // Volume analyser
      const analyser = rawCtx.createAnalyser(); analyser.fftSize = 256
      analyserRef.current = analyser
      src.connect(analyser)

      // Gain node (for mute)
      const gainNode = rawCtx.createGain(); gainNode.gain.value = 1
      gainRef.current = gainNode

      // PitchShift via Tone.js phase vocoder
      const shift = new Tone.PitchShift({
        pitch: VOICE_PRESETS[preset].pitch,
        windowSize: 0.06,
        delayTime: 0,
        feedback: 0,
      })
      shiftRef.current = shift

      // Bridge: raw AudioNode → Tone node → raw AudioNode (destination)
      src.connect(gainNode)
      gainNode.connect(shift.input)
      shift.toDestination()

      toneRef.current = { stream, Tone }

      // Volume animation
      const tick = () => {
        animRef.current = requestAnimationFrame(tick)
        const d = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(d)
        setVolume(d.reduce((a, b) => a + b, 0) / d.length / 255)
      }
      tick()

      setStatus('running')
    } catch (e) {
      setErr(e.message || 'Failed to start voice changer')
      setStatus('error')
    }
  }

  const stop = () => {
    cancelAnimationFrame(animRef.current)
    toneRef.current?.stream?.getTracks().forEach(t => t.stop())
    shiftRef.current?.disconnect()
    shiftRef.current = null
    gainRef.current = null
    toneRef.current = null
    setStatus('idle'); setVolume(0); setMuted(false); mutedRef.current = false
  }

  const isRunning = status === 'running'
  const v = VOICE_PRESETS[preset]
  const c = COLOR[v.color]

  return (
    <div className={standalone ? 'min-h-screen bg-slate-950 p-4' : ''}>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-100">🎙️ Live Voice Changer</h2>
            <p className="text-xs text-slate-500 mt-0.5">Real-time voice transform for WhatsApp, Zoom, any app</p>
          </div>
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            <button onClick={() => setPlatform('pc')}
              className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors font-medium
                ${platform === 'pc' ? 'bg-slate-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
              <Monitor size={12} /> PC
            </button>
            <button onClick={() => setPlatform('android')}
              className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors font-medium
                ${platform === 'android' ? 'bg-slate-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
              <Smartphone size={12} /> Android
            </button>
          </div>
        </div>

        {/* Setup guide */}
        {platform === 'pc' && (
          <div className="bg-blue-950/40 border border-blue-800/40 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-blue-300 mb-3">⚡ One-time PC Setup (2 min)</p>
            {[
              ['1', 'Download VB-Cable', 'vb-audio.com/Cable — free virtual audio cable', 'https://vb-audio.com/Cable/'],
              ['2', 'Install & restart PC', 'Creates "CABLE Input" & "CABLE Output" devices'],
              ['3', 'Start voice changer below', 'Select your real mic as Input, CABLE Input as Output'],
              ['4', 'In WhatsApp / any app', 'Settings → Microphone → select "CABLE Output"'],
              ['5', 'Call someone', 'They hear your changed voice in real time ✅'],
            ].map(([n, title, desc, link]) => (
              <div key={n} className="flex gap-3 items-start">
                <span className="w-5 h-5 shrink-0 rounded-full bg-blue-700/50 text-blue-300 text-[10px] font-bold flex items-center justify-center mt-0.5">{n}</span>
                <div>
                  <span className="text-xs font-medium text-blue-200">{title}</span>
                  {link && <a href={link} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 underline ml-1">{link}</a>}
                  <p className="text-[11px] text-blue-400/70">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {platform === 'android' && (
          <div className="bg-purple-950/40 border border-purple-800/40 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-purple-300 mb-3">📱 Android Options</p>
            <div className="space-y-3">
              <div className="bg-slate-900/60 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-200 mb-1">Option A — With a PC (best quality)</p>
                <p className="text-[11px] text-slate-400">Run the voice changer on your PC → set it to output to CABLE Input → make your WhatsApp call from WhatsApp Web on that PC. Full real-time voice change.</p>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-200 mb-1">Option B — Two Android phones</p>
                <p className="text-[11px] text-slate-400">Phone A: WhatsApp call on speaker. Phone B: Open this voice changer, speak into Phone B, processed voice plays through Phone B speaker near Phone A's mic.</p>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-200 mb-1">Option C — Android + Virtual Mic app</p>
                <p className="text-[11px] text-slate-400">Install <span className="text-purple-300 font-medium">WO Mic</span> or <span className="text-purple-300 font-medium">SoundBot</span> from Play Store to create a virtual mic. Then connect this page's output to it. Needs a rooted phone for deep integration.</p>
              </div>
            </div>
          </div>
        )}

        {/* Device selectors */}
        {status === 'idle' || status === 'error' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1.5 block">🎤 Input (Your Mic)</label>
              <div className="relative">
                <select
                  value={selectedInput}
                  onChange={e => setSelectedInput(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 pr-7 appearance-none focus:outline-none focus:border-slate-500"
                >
                  <option value="">Default Microphone</option>
                  {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Mic ' + d.deviceId.slice(0,6)}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1.5 block">🔊 Output (VB-Cable)</label>
              <div className="relative">
                <select
                  value={selectedOutput}
                  onChange={e => setSelectedOutput(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 pr-7 appearance-none focus:outline-none focus:border-slate-500"
                >
                  <option value="">Default Speaker</option>
                  {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Output ' + d.deviceId.slice(0,6)}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              {!sinkSupported && <p className="text-[10px] text-yellow-500 mt-1">⚠ Use Chrome for output routing</p>}
            </div>
          </div>
        ) : null}

        {/* Voice selector */}
        <div>
          <label className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-3 block">Voice Preset</label>
          <div className="grid grid-cols-3 gap-2">
            {VOICE_PRESETS.map((vp, i) => {
              const cc = COLOR[vp.color]
              const active = preset === i
              return (
                <button
                  key={i}
                  onClick={() => changePreset(i)}
                  className={`rounded-xl p-3 border transition-all text-center
                    ${active
                      ? `${cc.bg} ${cc.ring} ring-2 ${cc.glow}`
                      : 'bg-slate-800/60 border-slate-700/50 hover:border-slate-500'}`}
                >
                  <div className="text-2xl mb-1">{vp.emoji}</div>
                  <div className={`text-xs font-semibold ${active ? cc.text : 'text-slate-300'}`}>{vp.name}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{vp.desc}</div>
                  <div className={`text-[10px] mt-1 font-mono ${active ? cc.text : 'text-slate-600'}`}>
                    {vp.pitch === 0 ? 'no shift' : (vp.pitch > 0 ? `+${vp.pitch}` : vp.pitch) + ' semi'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Volume meter */}
        {isRunning && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <Volume2 size={12} /> Live — voice is being transformed
              </span>
              <span className={`text-xs font-semibold ${c.text}`}>{v.emoji} {v.name}</span>
            </div>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-75 ${c.bg}`}
                style={{ width: `${Math.min(volume * 300, 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-600 mt-2 text-center">
              {muted ? '🔇 Muted — no audio being sent' : '🔴 Mic active — speaking now transforms your voice'}
            </p>
          </div>
        )}

        {/* Error */}
        {err && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-xs text-red-400">{err}</div>
        )}

        {/* Controls */}
        <div className="flex gap-3">
          {!isRunning ? (
            <button
              onClick={start}
              disabled={status === 'loading'}
              className={`flex-1 flex items-center justify-center gap-2 font-semibold text-sm py-3.5 rounded-xl transition-all
                ${status === 'loading'
                  ? 'bg-slate-700 text-slate-400 cursor-wait'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_24px_rgba(16,185,129,0.35)]'}`}
            >
              <Play size={16} />
              {status === 'loading' ? 'Starting…' : 'Start Voice Changer'}
            </button>
          ) : (
            <>
              <button
                onClick={toggleMute}
                className={`flex items-center justify-center gap-2 font-semibold text-sm px-5 py-3.5 rounded-xl transition-all border
                  ${muted
                    ? 'bg-yellow-900/40 border-yellow-600/50 text-yellow-300'
                    : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'}`}
              >
                {muted ? <MicOff size={16} /> : <Mic size={16} />}
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={stop}
                className="flex-1 flex items-center justify-center gap-2 bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 text-red-300 font-semibold text-sm py-3.5 rounded-xl transition-all"
              >
                <Square size={16} />
                Stop
              </button>
            </>
          )}
        </div>

        {/* How it flows */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">How the audio flows</p>
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            {[
              ['🎤', 'Your mic'],
              ['→', ''],
              ['⚡', 'This page (pitch shift)'],
              ['→', ''],
              ['🔊', platform === 'pc' ? 'CABLE Input (VB-Cable)' : 'Speaker / loopback'],
              ['→', ''],
              ['📱', platform === 'pc' ? 'WhatsApp uses CABLE Output as mic' : 'Other phone\'s mic picks it up'],
              ['→', ''],
              ['👂', 'They hear changed voice'],
            ].map(([icon, label], i) =>
              icon === '→'
                ? <span key={i} className="text-slate-600">→</span>
                : <span key={i} className="flex items-center gap-1 bg-slate-800/60 rounded px-2 py-1">
                    <span>{icon}</span>
                    <span className="text-slate-400">{label}</span>
                  </span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
