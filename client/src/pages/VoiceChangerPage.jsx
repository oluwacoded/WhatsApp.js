import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, MicOff, Square, Play, Monitor, Smartphone, Volume2, ChevronDown, ExternalLink, RefreshCw, Send } from 'lucide-react'

const VOICE_PRESETS = [
  { name: 'Natural',    pitch: 0,    formant: 0,    emoji: '🎙️', color: 'slate',  desc: 'Your real voice' },
  { name: 'Girl',       pitch: 5,    formant: 1.1,  emoji: '🌸', color: 'pink',   desc: 'Female, natural' },
  { name: 'Young Girl', pitch: 9,    formant: 1.25, emoji: '✨', color: 'purple', desc: 'Higher, younger' },
  { name: 'Deep Man',   pitch: -4,   formant: 0.9,  emoji: '🎭', color: 'blue',   desc: 'Low, serious tone' },
  { name: 'Old Man',    pitch: -6,   formant: 0.85, emoji: '👴', color: 'amber',  desc: 'Older, gruff voice' },
  { name: 'Alien',      pitch: 7,    formant: 1.15, emoji: '👽', color: 'green',  desc: 'Eerie, unearthly' },
]

const COLOR = {
  slate:  { ring: 'ring-slate-500',  bg: 'bg-slate-700',     text: 'text-slate-300',   bar: 'bg-slate-400',   glow: '' },
  pink:   { ring: 'ring-pink-500',   bg: 'bg-pink-900/70',   text: 'text-pink-300',    bar: 'bg-pink-400',    glow: 'shadow-[0_0_24px_rgba(236,72,153,0.35)]' },
  purple: { ring: 'ring-purple-500', bg: 'bg-purple-900/70', text: 'text-purple-300',  bar: 'bg-purple-400',  glow: 'shadow-[0_0_24px_rgba(168,85,247,0.35)]' },
  blue:   { ring: 'ring-blue-500',   bg: 'bg-blue-900/70',   text: 'text-blue-300',    bar: 'bg-blue-400',    glow: 'shadow-[0_0_24px_rgba(59,130,246,0.35)]' },
  amber:  { ring: 'ring-amber-500',  bg: 'bg-amber-900/70',  text: 'text-amber-300',   bar: 'bg-amber-400',   glow: 'shadow-[0_0_24px_rgba(245,158,11,0.35)]' },
  green:  { ring: 'ring-green-500',  bg: 'bg-green-900/70',  text: 'text-green-300',   bar: 'bg-green-400',   glow: 'shadow-[0_0_24px_rgba(34,197,94,0.35)]' },
}

const isAndroid = () => /android/i.test(navigator.userAgent)
const isMobile  = () => /mobile|android|iphone|ipad/i.test(navigator.userAgent)

export default function VoiceChangerPage({ standalone = false }) {
  const [platform, setPlatform]           = useState(() => isAndroid() ? 'android' : 'pc')
  const [inputDevices, setInputDevices]   = useState([])
  const [outputDevices, setOutputDevices] = useState([])
  const [selectedInput, setSelectedInput]   = useState('')
  const [selectedOutput, setSelectedOutput] = useState('')
  const [preset, setPreset] = useState(0)
  const [status, setStatus] = useState('idle')  // idle | loading | running | error
  const [volume, setVolume] = useState(0)
  const [muted, setMuted]   = useState(false)
  const [err, setErr]       = useState('')
  const [sinkOk, setSinkOk] = useState(false)

  const shiftRef   = useRef(null)
  const gainRef    = useRef(null)
  const animRef    = useRef(null)
  const sessionRef = useRef(null)   // { stream, Tone }

  const onMobile = isMobile()

  // Request mic on load to populate device list
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => navigator.mediaDevices.enumerateDevices())
      .then(devs => {
        setInputDevices(devs.filter(d => d.kind === 'audioinput'))
        setOutputDevices(devs.filter(d => d.kind === 'audiooutput'))
        setSinkOk('setSinkId' in HTMLAudioElement.prototype)
      })
      .catch(() => setErr('Microphone blocked — tap the lock icon in your address bar, allow microphone, then refresh.'))
  }, [])

  const changePreset = useCallback((idx) => {
    setPreset(idx)
    if (shiftRef.current) {
      shiftRef.current.pitch = VOICE_PRESETS[idx].pitch
    }
  }, [])

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev
      if (gainRef.current) gainRef.current.gain.linearRampToValueAtTime(next ? 0 : 1, gainRef.current.context.currentTime + 0.05)
      return next
    })
  }, [])

  const start = async () => {
    setStatus('loading'); setErr('')
    try {
      // Dynamic import keeps initial bundle small
      const Tone = (await import('tone'))

      // Resume AudioContext — some browsers suspend it until user gesture
      const ctx = Tone.getContext()
      if (ctx.state !== 'running') {
        await Tone.start()
        // Wait up to 3s for context to actually start
        let waited = 0
        while (ctx.state !== 'running' && waited < 3000) {
          await new Promise(r => setTimeout(r, 100))
          waited += 100
        }
        if (ctx.state !== 'running') throw new Error('AudioContext could not start — try Chrome or Edge browser')
      }

      // Get microphone — try specific device first, fall back to default
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedInput ? { exact: selectedInput } : undefined,
            echoCancellation: false,   // OFF — we handle this ourselves
            noiseSuppression: false,   // OFF — ruins the pitch shift output
            autoGainControl: false,    // OFF — causes volume pumping
          }
        })
      } catch {
        // Stale device ID or device gone — fall back to default mic
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        })
      }

      const rawCtx = ctx.rawContext

      // ── Audio graph:
      //   mic → analyser (for VU meter)
      //       → gainNode (mute control)
      //         → PitchShift (voice change)  ← best window size for quality/latency balance
      //           → BiquadFilter (hi-pass, removes low-freq rumble from pitch shift)
      //             → DynamicsCompressor (normalises level)
      //               → destination (speakers / VB-Cable)

      const src      = rawCtx.createMediaStreamSource(stream)
      const analyser = rawCtx.createAnalyser(); analyser.fftSize = 512

      const gainNode = rawCtx.createGain(); gainNode.gain.value = 1
      gainRef.current = gainNode

      // PitchShift — windowSize 0.25 is the sweet spot for natural voice quality
      // Lower (0.1) = more artifacts. Higher (0.5) = smooth but adds ~250ms latency.
      const p = VOICE_PRESETS[preset]
      const shift = new Tone.PitchShift({
        pitch:      p.pitch,
        windowSize: 0.25,    // 250ms window — smooth, natural sound
        delayTime:  0,       // no extra delay
        feedback:   0,       // no echo
        wet:        p.pitch === 0 ? 0 : 1,   // bypass when Natural
      })
      shiftRef.current = shift

      // High-pass filter — removes low-frequency artifacts that PitchShift introduces
      const hpFilter = rawCtx.createBiquadFilter()
      hpFilter.type = 'highpass'
      hpFilter.frequency.value = 80   // cut below 80Hz (rumble / bass artifact)

      // Dynamics compressor — keeps output level consistent across voices
      const comp = rawCtx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.knee.value      = 8
      comp.ratio.value     = 3
      comp.attack.value    = 0.003
      comp.release.value   = 0.15

      // Wire it up
      src.connect(analyser)
      src.connect(gainNode)
      Tone.connect(gainNode, shift)
      shift.connect(hpFilter)
      hpFilter.connect(comp)
      comp.connect(rawCtx.destination)

      // Route output to selected device (VB-Cable on PC)
      if (selectedOutput) {
        try { await rawCtx.setSinkId(selectedOutput) } catch {}
      }

      sessionRef.current = { stream, Tone }

      // VU meter loop
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        animRef.current = requestAnimationFrame(tick)
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setVolume(avg / 128)   // 0-1 range (128 = half of 255)
      }
      tick()

      setStatus('running')
    } catch (e) {
      const msg = (e.message || '').toLowerCase()
      if (msg.includes('permission') || msg.includes('denied') || msg.includes('not allowed')) {
        setErr('Microphone permission denied — tap the 🔒 in your address bar, allow microphone, then refresh.')
      } else if (msg.includes('notfound') || msg.includes('not found') || e.name === 'NotFoundError') {
        setErr('Microphone not found — make sure it is plugged in and not in use by another app.')
      } else if (msg.includes('audiocontext') || msg.includes('could not start')) {
        setErr(e.message + '. Use Chrome or Edge for best compatibility.')
      } else {
        setErr('Could not start: ' + e.message)
      }
      setStatus('error')
    }
  }

  const stop = () => {
    cancelAnimationFrame(animRef.current)
    sessionRef.current?.stream?.getTracks().forEach(t => t.stop())
    try { shiftRef.current?.disconnect() } catch {}
    shiftRef.current = null
    gainRef.current  = null
    sessionRef.current = null
    setStatus('idle'); setVolume(0); setMuted(false); setErr('')
  }

  const retry = () => { stop(); setTimeout(start, 300) }

  const isRunning = status === 'running'
  const v = VOICE_PRESETS[preset]
  const c = COLOR[v.color]

  return (
    <div className={standalone ? 'min-h-screen bg-slate-950 p-4 md:p-8' : ''}>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-100">🎙️ Real-Time Voice Changer</h2>
            <p className="text-xs text-slate-500 mt-0.5">Change your voice live on any call</p>
          </div>
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
            {[
              { id:'pc',       icon: Monitor,    label:'PC' },
              { id:'android',  icon: Smartphone, label:'Android' },
              { id:'telegram', icon: Send,       label:'Telegram' },
            ].map(({ id, icon: Icon, label }) => (
              <button key={id} onClick={() => setPlatform(id)}
                className={`text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-colors
                  ${platform === id ? 'bg-slate-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── PC GUIDE ── */}
        {platform === 'pc' && (
          <div className="bg-blue-950/40 border border-blue-800/40 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-blue-800/30">
              <p className="text-xs font-bold text-blue-300">🖥️ How to use on PC (Windows / Mac)</p>
              <p className="text-[11px] text-blue-400/70 mt-0.5">One-time setup — takes about 2 minutes.</p>
            </div>
            <div className="divide-y divide-blue-900/30">
              {[
                { n:1, head:'Download free VB-Cable', body:'Creates a virtual microphone on your PC. WhatsApp will use it and hear your changed voice.', link:'https://vb-audio.com/Cable/', linkText:'vb-audio.com/Cable — free download' },
                { n:2, head:'Install it and restart your PC', body:'After restart, come back to this page in Chrome or Edge.' },
                { n:3, head:'Set the dropdowns below', body:null, table:[['🎤 Your Real Mic','your normal microphone'],['🔊 Send Voice To','CABLE Input (VB-Audio)']] },
                { n:4, head:'Pick a voice, press Start', body:'You should see the volume bar move when you speak.' },
                { n:5, head:'Tell WhatsApp to use the fake mic', body:'WhatsApp Desktop → Settings → Devices → Microphone → select "CABLE Output (VB-Audio)"' },
              ].map(step => (
                <div key={step.n} className="px-4 py-3 flex gap-3">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-blue-700 text-white text-[11px] font-bold flex items-center justify-center">{step.n}</span>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-slate-100">{step.head}</p>
                    {step.body && <p className="text-xs text-slate-400">{step.body}</p>}
                    {step.link && <a href={step.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-400 underline font-medium"><ExternalLink size={11}/> {step.linkText}</a>}
                    {step.table && (
                      <div className="bg-slate-800/60 rounded-lg p-3 space-y-1.5 text-xs">
                        {step.table.map(([l,r]) => (
                          <div key={l} className="flex justify-between gap-4">
                            <span className="text-slate-400">{l}</span>
                            <span className={`font-medium ${r.includes('CABLE') ? 'text-pink-300' : 'text-slate-200'}`}>{r}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="px-4 py-3 flex gap-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-emerald-700 text-white text-[11px] font-bold flex items-center justify-center">✓</span>
                <div>
                  <p className="text-sm font-semibold text-emerald-300">Call anyone — they hear your changed voice!</p>
                  <p className="text-xs text-slate-400 mt-0.5">Keep this tab open during the call.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ANDROID GUIDE ── */}
        {platform === 'android' && (
          <div className="bg-purple-950/40 border border-purple-800/40 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-purple-800/30">
              <p className="text-xs font-bold text-purple-300">📱 Using on Android</p>
              <p className="text-[11px] text-purple-400/70 mt-0.5">Pick the method that works for your setup.</p>
            </div>

            <div className="px-4 py-4 border-b border-purple-900/30">
              <div className="flex items-start gap-3">
                <span className="shrink-0 bg-emerald-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-full mt-0.5">METHOD 1</span>
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-bold text-emerald-300">Two-phone trick — works perfectly, no setup</p>
                  <div className="bg-slate-800/60 rounded-xl p-3 space-y-2 text-xs">
                    {[
                      ['1','Start the WhatsApp call on Phone 1, put it on speaker mode'],
                      ['2','On Phone 2 (this page), pick your voice below and press Start'],
                      ['3','Hold Phone 2 close to Phone 1 — speak into Phone 2'],
                      ['✓','The other person hears your changed voice from Phone 2 via Phone 1\'s mic'],
                    ].map(([n, t]) => (
                      <div key={n} className="flex gap-2.5 items-start">
                        <span className={`w-5 h-5 shrink-0 rounded-full font-bold flex items-center justify-center text-[10px] ${n==='✓'?'bg-emerald-700 text-emerald-200':'bg-slate-700 text-slate-300'}`}>{n}</span>
                        <span className={n==='✓'?'text-emerald-300 font-medium':'text-slate-200'}>{t}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500">Works with any Android. No apps needed. No rooting.</p>
                </div>
              </div>
            </div>

            <div className="px-4 py-4 border-b border-purple-900/30">
              <div className="flex items-start gap-3">
                <span className="shrink-0 bg-blue-700 text-white text-[10px] font-bold px-2.5 py-1 rounded-full mt-0.5">METHOD 2</span>
                <div>
                  <p className="text-sm font-bold text-blue-300">Use WhatsApp Web on a PC instead</p>
                  <p className="text-xs text-slate-400 mt-1">If you have a PC, call from WhatsApp Web there with VB-Cable. Switch to the <span className="text-white font-medium">PC tab</span> above for the full setup guide.</p>
                </div>
              </div>
            </div>

            <div className="px-4 py-3">
              <p className="text-[11px] text-slate-500"><span className="text-slate-400 font-medium">Why can't I route directly?</span> Android blocks web pages from piping audio into WhatsApp's mic for security reasons. Neither method needs rooting.</p>
            </div>
          </div>
        )}

        {/* ── TELEGRAM GUIDE ── */}
        {platform === 'telegram' && (
          <div className="bg-sky-950/40 border border-sky-800/40 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-sky-800/30">
              <p className="text-xs font-bold text-sky-300">📨 Using on Telegram Desktop (PC)</p>
              <p className="text-[11px] text-sky-400/70 mt-0.5">Same VB-Cable setup as WhatsApp — works perfectly on Telegram Desktop.</p>
            </div>
            <div className="divide-y divide-sky-900/30">
              <div className="px-4 py-3 flex gap-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-sky-700 text-white text-[11px] font-bold flex items-center justify-center">1</span>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-100">Install VB-Cable (if not done yet)</p>
                  <p className="text-xs text-slate-400">Creates a virtual microphone. Telegram will use it to send your changed voice.</p>
                  <a href="https://vb-audio.com/Cable/" target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-sky-400 underline font-medium mt-1">
                    <ExternalLink size={11}/> vb-audio.com/Cable — free download
                  </a>
                </div>
              </div>
              <div className="px-4 py-3 flex gap-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-sky-700 text-white text-[11px] font-bold flex items-center justify-center">2</span>
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-100">Set dropdowns below</p>
                  <div className="bg-slate-800/60 rounded-lg p-3 space-y-1.5 text-xs">
                    {[['🎤 Your Real Mic','your normal microphone'],['🔊 Send Voice To','CABLE Input (VB-Audio)']].map(([l,r])=>(
                      <div key={l} className="flex justify-between gap-4">
                        <span className="text-slate-400">{l}</span>
                        <span className={`font-medium ${r.includes('CABLE')?'text-sky-300':'text-slate-200'}`}>{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 flex gap-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-sky-700 text-white text-[11px] font-bold flex items-center justify-center">3</span>
                <div>
                  <p className="text-sm font-semibold text-slate-100">Pick a voice and press Start</p>
                  <p className="text-xs text-slate-400 mt-0.5">You should see the volume bar move when you speak.</p>
                </div>
              </div>
              <div className="px-4 py-3 flex gap-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-sky-700 text-white text-[11px] font-bold flex items-center justify-center">4</span>
                <div>
                  <p className="text-sm font-semibold text-slate-100">Set Telegram Desktop to use CABLE Output</p>
                  <div className="bg-slate-800/60 rounded-lg p-3 mt-2 text-xs text-slate-300 space-y-1">
                    <p><span className="text-sky-300 font-medium">Telegram Desktop:</span> Settings → Privacy & Security → Voice Calls → Input device → select <span className="text-sky-300 font-semibold">"CABLE Output (VB-Audio)"</span></p>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 flex gap-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-emerald-700 text-white text-[11px] font-bold flex items-center justify-center">✓</span>
                <div>
                  <p className="text-sm font-semibold text-emerald-300">Make a Telegram voice call — they hear your changed voice!</p>
                  <p className="text-xs text-slate-400 mt-0.5">Works for 1-on-1 calls and group voice chats. Keep this tab open.</p>
                </div>
              </div>
            </div>

            {/* Mobile Telegram */}
            <div className="px-4 py-4 border-t border-sky-800/30">
              <div className="flex items-start gap-3">
                <span className="shrink-0 bg-slate-700 text-slate-300 text-[10px] font-bold px-2.5 py-1 rounded-full mt-0.5">MOBILE</span>
                <div>
                  <p className="text-sm font-semibold text-slate-100">Telegram on phone — use the two-phone trick</p>
                  <p className="text-xs text-slate-400 mt-1">On Phone 1: start a Telegram voice call on speaker. On Phone 2: open this page, start voice changer, hold it near Phone 1. Same trick as Android.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Device selectors */}
        {!isRunning && (
          <div className={`grid gap-3 ${onMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <div>
              <label className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-1.5 block">🎤 Your Real Mic</label>
              <div className="relative">
                <select value={selectedInput} onChange={e => setSelectedInput(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 pr-7 appearance-none focus:outline-none focus:border-slate-500">
                  <option value="">Default microphone</option>
                  {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>
            {!onMobile && (
              <div>
                <label className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide mb-1.5 block">🔊 Send Voice To</label>
                <div className="relative">
                  <select value={selectedOutput} onChange={e => setSelectedOutput(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 pr-7 appearance-none focus:outline-none focus:border-slate-500">
                    <option value="">Default speaker</option>
                    {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                {!sinkOk && <p className="text-[10px] text-yellow-500 mt-1">⚠ Use Chrome or Edge to route to VB-Cable</p>}
                {sinkOk && !selectedOutput && <p className="text-[10px] text-blue-400 mt-1">← Select "CABLE Input" here for WhatsApp</p>}
              </div>
            )}
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
                  className={`rounded-xl p-3 border transition-all text-center cursor-pointer
                    ${active ? `${cc.bg} border-transparent ring-2 ${cc.ring} ${cc.glow}` : 'bg-slate-800/60 border-slate-700/50 hover:border-slate-500 hover:bg-slate-800'}`}>
                  <div className="text-2xl mb-1">{vp.emoji}</div>
                  <div className={`text-xs font-bold ${active ? cc.text : 'text-slate-300'}`}>{vp.name}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{vp.desc}</div>
                  {active && vp.pitch !== 0 && (
                    <div className={`text-[9px] mt-1 font-mono ${cc.text} opacity-70`}>
                      {vp.pitch > 0 ? `+${vp.pitch}` : vp.pitch} semitones
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* VU meter while running */}
        {isRunning && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <Volume2 size={12} />
                {muted ? 'Muted — nothing going out' : 'Live — speak to test your voice'}
              </span>
              <span className={`text-xs font-bold ${c.text}`}>{v.emoji} {v.name}</span>
            </div>
            {/* Segmented VU meter */}
            <div className="flex gap-0.5 h-4">
              {Array.from({ length: 32 }).map((_, i) => {
                const threshold = (i + 1) / 32
                const active = volume >= threshold * 0.85
                return (
                  <div key={i} className={`flex-1 rounded-[2px] transition-all duration-75
                    ${active ? (i < 22 ? c.bar : i < 28 ? 'bg-yellow-400' : 'bg-red-500') : 'bg-slate-800'}`} />
                )
              })}
            </div>
            {!muted && volume < 0.03 && (
              <p className="text-[11px] text-yellow-500 text-center">No signal detected — check your mic is allowed and selected</p>
            )}
            {onMobile && volume > 0.03 && (
              <p className="text-[11px] text-emerald-400 text-center font-medium">
                🔊 Working! Hold this phone's speaker near your other phone's mic
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {err && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 flex items-start gap-3">
            <span className="text-red-400 text-xs mt-0.5">❌</span>
            <div className="flex-1">
              <p className="text-xs text-red-400">{err}</p>
              <button onClick={retry} className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-red-300 underline">
                <RefreshCw size={10} /> Try again
              </button>
            </div>
          </div>
        )}

        {/* Start / Stop / Mute */}
        <div className="flex gap-3">
          {!isRunning ? (
            <button onClick={start} disabled={status === 'loading'}
              className={`flex-1 flex items-center justify-center gap-2 font-bold text-sm py-4 rounded-xl transition-all
                ${status === 'loading'
                  ? 'bg-slate-700 text-slate-400 cursor-wait'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-[0_0_28px_rgba(16,185,129,0.35)]'}`}>
              {status === 'loading' ? (
                <><RefreshCw size={15} className="animate-spin" /> Starting…</>
              ) : (
                <><Play size={15} /> Start Voice Changer</>
              )}
            </button>
          ) : (
            <>
              <button onClick={toggleMute}
                className={`flex items-center gap-2 font-semibold text-sm px-5 py-4 rounded-xl border transition-all
                  ${muted ? 'bg-yellow-900/40 border-yellow-600/50 text-yellow-300' : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'}`}>
                {muted ? <MicOff size={15} /> : <Mic size={15} />}
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button onClick={stop}
                className="flex-1 flex items-center justify-center gap-2 bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 text-red-300 font-semibold text-sm py-4 rounded-xl transition-all">
                <Square size={15} /> Stop
              </button>
            </>
          )}
        </div>

        {!isRunning && (
          <p className="text-center text-[11px] text-slate-600">
            Keep this tab open during your call — closing it stops the voice change
          </p>
        )}

      </div>
    </div>
  )
}
