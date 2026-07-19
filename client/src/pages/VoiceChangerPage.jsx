import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, Square, Play, Monitor, Smartphone, Volume2, ChevronDown, ExternalLink } from 'lucide-react'

const VOICE_PRESETS = [
  { name: 'Natural',    pitch: 0,   emoji: '🎙️', color: 'slate',  desc: 'Your real voice, no change' },
  { name: 'Girl',       pitch: 8,   emoji: '🌸', color: 'pink',   desc: 'Sounds like a woman' },
  { name: 'Young Girl', pitch: 12,  emoji: '✨', color: 'purple', desc: 'Higher, younger girl' },
  { name: 'Deep Man',   pitch: -5,  emoji: '🎭', color: 'blue',   desc: 'Low, serious male voice' },
  { name: 'Old Man',    pitch: -8,  emoji: '👴', color: 'amber',  desc: 'Sounds older, gruff' },
  { name: 'Alien',      pitch: 6,   emoji: '👽', color: 'green',  desc: 'Eerie, weird pitch' },
]

const COLOR = {
  slate:  { ring: 'ring-slate-500',  bg: 'bg-slate-700',    text: 'text-slate-300',   glow: '' },
  pink:   { ring: 'ring-pink-500',   bg: 'bg-pink-900/70',  text: 'text-pink-300',    glow: 'shadow-[0_0_20px_rgba(236,72,153,0.4)]' },
  purple: { ring: 'ring-purple-500', bg: 'bg-purple-900/70',text: 'text-purple-300',  glow: 'shadow-[0_0_20px_rgba(168,85,247,0.4)]' },
  blue:   { ring: 'ring-blue-500',   bg: 'bg-blue-900/70',  text: 'text-blue-300',    glow: 'shadow-[0_0_20px_rgba(59,130,246,0.4)]' },
  amber:  { ring: 'ring-amber-500',  bg: 'bg-amber-900/70', text: 'text-amber-300',   glow: 'shadow-[0_0_20px_rgba(245,158,11,0.4)]' },
  green:  { ring: 'ring-green-500',  bg: 'bg-green-900/70', text: 'text-green-300',   glow: 'shadow-[0_0_20px_rgba(34,197,94,0.4)]' },
}

export default function VoiceChangerPage({ standalone = false }) {
  const [platform, setPlatform]           = useState('pc')
  const [inputDevices, setInputDevices]   = useState([])
  const [outputDevices, setOutputDevices] = useState([])
  const [selectedInput, setSelectedInput]   = useState('')
  const [selectedOutput, setSelectedOutput] = useState('')
  const [preset, setPreset]   = useState(0)
  const [status, setStatus]   = useState('idle')
  const [volume, setVolume]   = useState(0)
  const [muted, setMuted]     = useState(false)
  const [err, setErr]         = useState('')
  const [sinkOk, setSinkOk]   = useState(false)

  const shiftRef   = useRef(null)
  const gainRef    = useRef(null)
  const animRef    = useRef(null)
  const toneRef    = useRef(null)

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then(devs => {
        setInputDevices(devs.filter(d => d.kind === 'audioinput'))
        setOutputDevices(devs.filter(d => d.kind === 'audiooutput'))
        setSinkOk('setSinkId' in HTMLAudioElement.prototype)
      })
      .catch(() => setErr('❌ Microphone blocked. Tap the lock icon in your browser address bar and allow microphone, then refresh.'))
  }, [])

  const changePreset = useCallback((idx) => {
    setPreset(idx)
    if (shiftRef.current) shiftRef.current.pitch = VOICE_PRESETS[idx].pitch
  }, [])

  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
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

      if (selectedOutput && rawCtx.setSinkId) {
        try { await rawCtx.setSinkId(selectedOutput) } catch {}
      }

      const src      = rawCtx.createMediaStreamSource(stream)
      const analyser = rawCtx.createAnalyser(); analyser.fftSize = 256
      const gainNode = rawCtx.createGain(); gainNode.gain.value = 1
      gainRef.current = gainNode

      const shift = new Tone.PitchShift({ pitch: VOICE_PRESETS[preset].pitch, windowSize: 0.06, delayTime: 0, feedback: 0 })
      shiftRef.current = shift

      src.connect(analyser)
      src.connect(gainNode)
      gainNode.connect(shift.input)
      shift.toDestination()

      toneRef.current = { stream }

      const tick = () => {
        animRef.current = requestAnimationFrame(tick)
        const d = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(d)
        setVolume(d.reduce((a, b) => a + b, 0) / d.length / 255)
      }
      tick()
      setStatus('running')
    } catch (e) {
      setErr('❌ ' + (e.message || 'Could not start. Make sure you allowed microphone access.'))
      setStatus('error')
    }
  }

  const stop = () => {
    cancelAnimationFrame(animRef.current)
    toneRef.current?.stream?.getTracks().forEach(t => t.stop())
    shiftRef.current?.disconnect()
    shiftRef.current = null; gainRef.current = null; toneRef.current = null
    setStatus('idle'); setVolume(0); setMuted(false)
  }

  const isRunning = status === 'running'
  const v = VOICE_PRESETS[preset]
  const c = COLOR[v.color]

  return (
    <div className={standalone ? 'min-h-screen bg-slate-950 p-4 md:p-8' : ''}>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-100">🎙️ Real-Time Voice Changer</h2>
            <p className="text-xs text-slate-500 mt-0.5">Change your voice on any WhatsApp call, Zoom, or phone call</p>
          </div>
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            <button onClick={() => setPlatform('pc')}
              className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-colors
                ${platform === 'pc' ? 'bg-slate-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
              <Monitor size={12} /> PC
            </button>
            <button onClick={() => setPlatform('android')}
              className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-colors
                ${platform === 'android' ? 'bg-slate-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
              <Smartphone size={12} /> Android
            </button>
          </div>
        </div>

        {/* ── PC GUIDE ── */}
        {platform === 'pc' && (
          <div className="space-y-3">
            <div className="bg-blue-950/40 border border-blue-800/40 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-blue-800/30">
                <p className="text-xs font-bold text-blue-300">🖥️ How to use on PC (Windows or Mac)</p>
                <p className="text-[11px] text-blue-400/70 mt-0.5">Do this once. Takes about 2 minutes.</p>
              </div>
              <div className="divide-y divide-blue-900/30">
                {/* Step 1 */}
                <div className="px-4 py-3 flex gap-3">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-blue-700 text-white text-[11px] font-bold flex items-center justify-center">1</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Download a free program called VB-Cable</p>
                    <p className="text-xs text-slate-400">This program tricks your PC into thinking there's a second microphone. WhatsApp will use that fake mic and hear your changed voice.</p>
                    <a href="https://vb-audio.com/Cable/" target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-blue-400 underline font-medium mt-1">
                      <ExternalLink size={11} /> vb-audio.com/Cable — click Download, it's free
                    </a>
                  </div>
                </div>
                {/* Step 2 */}
                <div className="px-4 py-3 flex gap-3">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-blue-700 text-white text-[11px] font-bold flex items-center justify-center">2</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Install it and restart your PC</p>
                    <p className="text-xs text-slate-400">Run the installer, then restart. After restart, come back to this page.</p>
                  </div>
                </div>
                {/* Step 3 */}
                <div className="px-4 py-3 flex gap-3">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-blue-700 text-white text-[11px] font-bold flex items-center justify-center">3</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Open this page in Chrome (not Safari, not Firefox)</p>
                    <p className="text-xs text-slate-400">The output routing only works in Chrome and Edge. Copy the link and paste it in Chrome if you're not already there.</p>
                  </div>
                </div>
                {/* Step 4 */}
                <div className="px-4 py-3 flex gap-3">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-blue-700 text-white text-[11px] font-bold flex items-center justify-center">4</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Set the dropdowns below like this:</p>
                    <div className="bg-slate-800/60 rounded-lg p-3 mt-1 space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-400">🎤 Input (Your Mic)</span>
                        <span className="text-slate-200 font-medium">→ your normal microphone</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">🔊 Output (where voice goes)</span>
                        <span className="text-pink-300 font-medium">→ CABLE Input (VB-Audio)</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">If you don't see "CABLE Input" in the list, the VB-Cable install didn't finish — restart your PC again.</p>
                  </div>
                </div>
                {/* Step 5 */}
                <div className="px-4 py-3 flex gap-3">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-blue-700 text-white text-[11px] font-bold flex items-center justify-center">5</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Pick a voice below and press Start</p>
                    <p className="text-xs text-slate-400">You should see the volume bar move when you talk. That means it's working.</p>
                  </div>
                </div>
                {/* Step 6 */}
                <div className="px-4 py-3 flex gap-3">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-blue-700 text-white text-[11px] font-bold flex items-center justify-center">6</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Tell WhatsApp to use the fake mic</p>
                    <div className="bg-slate-800/60 rounded-lg p-3 mt-1 text-xs text-slate-300 space-y-1">
                      <p>In <span className="text-blue-300 font-medium">WhatsApp Desktop</span>: Settings → Devices → Microphone → select <span className="text-pink-300 font-semibold">"CABLE Output (VB-Audio)"</span></p>
                      <p className="text-slate-500">Note: the Output dropdown here and the "CABLE Output" in WhatsApp are two different things — VB-Cable connects them internally.</p>
                    </div>
                  </div>
                </div>
                {/* Step 7 */}
                <div className="px-4 py-3 flex gap-3">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-emerald-700 text-white text-[11px] font-bold flex items-center justify-center">✓</span>
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">Call anyone on WhatsApp — they hear your changed voice!</p>
                    <p className="text-xs text-slate-400 mt-0.5">Keep this browser tab open while you're on the call. Closing it stops the voice change.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ANDROID GUIDE ── */}
        {platform === 'android' && (
          <div className="space-y-3">
            <div className="bg-purple-950/40 border border-purple-800/40 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-purple-800/30">
                <p className="text-xs font-bold text-purple-300">📱 How to use on Android</p>
                <p className="text-[11px] text-purple-400/70 mt-0.5">Android doesn't let web pages talk directly to WhatsApp's mic, so you have a few workarounds.</p>
              </div>

              {/* Option A */}
              <div className="px-4 py-4 border-b border-purple-900/30">
                <div className="flex items-start gap-3">
                  <span className="shrink-0 bg-emerald-700/50 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5">BEST</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Option A — Use WhatsApp Web on a PC</p>
                    <p className="text-xs text-slate-400">Instead of calling from your phone, call from WhatsApp Web in Chrome on a PC. Follow the PC guide above. The other person can't tell the difference — you sound exactly the same to them, just with your voice changed.</p>
                    <p className="text-[11px] text-slate-500 mt-1">Best quality, zero lag, no extra hardware needed.</p>
                  </div>
                </div>
              </div>

              {/* Option B */}
              <div className="px-4 py-4 border-b border-purple-900/30">
                <div className="flex items-start gap-3">
                  <span className="shrink-0 bg-blue-700/50 text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5">OK</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Option B — Two phones</p>
                    <p className="text-xs text-slate-400">
                      You need 2 phones for this:
                    </p>
                    <div className="bg-slate-800/60 rounded-lg p-3 mt-2 space-y-2 text-xs">
                      <div className="flex gap-2"><span className="text-purple-400 font-bold shrink-0">Phone 1:</span><span className="text-slate-300">The WhatsApp call, on <span className="font-semibold">speaker mode</span></span></div>
                      <div className="flex gap-2"><span className="text-purple-400 font-bold shrink-0">Phone 2:</span><span className="text-slate-300">Open this voice changer page. Pick your voice. Press Start. Speak into Phone 2.</span></div>
                      <div className="flex gap-2"><span className="text-emerald-400 font-bold shrink-0">Result:</span><span className="text-slate-300">Your changed voice plays from Phone 2's speaker → Phone 1's mic picks it up → other person hears it</span></div>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">Hold the phones close together. Works surprisingly well.</p>
                  </div>
                </div>
              </div>

              {/* Option C */}
              <div className="px-4 py-4">
                <div className="flex items-start gap-3">
                  <span className="shrink-0 bg-slate-700/50 text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5">HARD</span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">Option C — Virtual mic app (rooted Android only)</p>
                    <p className="text-xs text-slate-400">If your Android is rooted, install <span className="text-purple-300 font-medium">WO Mic</span> from the Play Store. It creates a fake microphone on your Android, same idea as VB-Cable on PC. Then connect this voice changer's output to it.</p>
                    <p className="text-[11px] text-slate-500 mt-1">Most people's phones are NOT rooted. Skip this unless you know what rooting means.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Device selectors — only show when idle */}
        {!isRunning && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-1.5 block">🎤 Your Real Mic</label>
              <div className="relative">
                <select value={selectedInput} onChange={e => setSelectedInput(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 pr-7 appearance-none focus:outline-none focus:border-slate-500">
                  <option value="">Default (auto)</option>
                  {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-1.5 block">🔊 Send Voice To</label>
              <div className="relative">
                <select value={selectedOutput} onChange={e => setSelectedOutput(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 pr-7 appearance-none focus:outline-none focus:border-slate-500">
                  <option value="">Default Speaker</option>
                  {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
              {!sinkOk && <p className="text-[10px] text-yellow-500 mt-1">⚠ Switch to Chrome to route to VB-Cable</p>}
              {sinkOk && !selectedOutput && <p className="text-[10px] text-blue-400 mt-1">← Select "CABLE Input" here for WhatsApp</p>}
            </div>
          </div>
        )}

        {/* Voice picker */}
        <div>
          <label className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-3 block">Choose Your Voice</label>
          <div className="grid grid-cols-3 gap-2">
            {VOICE_PRESETS.map((vp, i) => {
              const cc = COLOR[vp.color]
              const active = preset === i
              return (
                <button key={i} onClick={() => changePreset(i)}
                  className={`rounded-xl p-3 border transition-all text-center
                    ${active ? `${cc.bg} ${cc.ring} ring-2 ${cc.glow}` : 'bg-slate-800/60 border-slate-700/50 hover:border-slate-500'}`}>
                  <div className="text-2xl mb-1">{vp.emoji}</div>
                  <div className={`text-xs font-bold ${active ? cc.text : 'text-slate-300'}`}>{vp.name}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{vp.desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Volume bar while running */}
        {isRunning && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <Volume2 size={12} />
                {muted ? 'Muted — nothing is going out' : 'Live — speak now to test'}
              </span>
              <span className={`text-xs font-bold ${c.text}`}>{v.emoji} {v.name}</span>
            </div>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-75 ${c.bg}`}
                style={{ width: `${Math.min(volume * 300, 100)}%` }} />
            </div>
            <p className="text-[10px] text-slate-600 text-center mt-2">
              {isRunning && !muted ? '🔴 Your voice is being changed and sent to the selected output' : ''}
            </p>
          </div>
        )}

        {/* Error */}
        {err && <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-xs text-red-400">{err}</div>}

        {/* Start / Stop / Mute */}
        <div className="flex gap-3">
          {!isRunning ? (
            <button onClick={start} disabled={status === 'loading'}
              className={`flex-1 flex items-center justify-center gap-2 font-bold text-sm py-4 rounded-xl transition-all
                ${status === 'loading'
                  ? 'bg-slate-700 text-slate-400 cursor-wait'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_28px_rgba(16,185,129,0.4)]'}`}>
              <Play size={16} />
              {status === 'loading' ? 'Starting…' : 'Start Voice Changer'}
            </button>
          ) : (
            <>
              <button onClick={toggleMute}
                className={`flex items-center gap-2 font-semibold text-sm px-5 py-4 rounded-xl border transition-all
                  ${muted ? 'bg-yellow-900/40 border-yellow-600/50 text-yellow-300' : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'}`}>
                {muted ? <MicOff size={16} /> : <Mic size={16} />}
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button onClick={stop}
                className="flex-1 flex items-center justify-center gap-2 bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 text-red-300 font-semibold text-sm py-4 rounded-xl transition-all">
                <Square size={16} /> Stop
              </button>
            </>
          )}
        </div>

        {/* Quick reminder */}
        {!isRunning && (
          <p className="text-center text-[11px] text-slate-600">
            Keep this tab open while on your call — closing it stops the voice change
          </p>
        )}

      </div>
    </div>
  )
}
