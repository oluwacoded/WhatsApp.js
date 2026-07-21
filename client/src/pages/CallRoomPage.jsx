import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Mic, MicOff, PhoneOff, Copy, Check, ChevronLeft, Users, Volume2, Upload } from 'lucide-react'

// Tone.js PitchShift — proper phase vocoder. pitch in semitones.
// Female = +8 semitones (same as VoiceChangerPage "Girl" — sounds like a real woman, NOT chipmunk).
// Elon Musk / Collin Raye = pitch-shifted approximations of their voice register.
const VOICE_MODES = [
  { voiceId: 'natural',  name: 'Natural',      emoji: '🎙️', semitones:  0,  tag: 'your real voice' },
  { voiceId: 'female',   name: 'Female',        emoji: '👩', semitones:  8,  tag: 'real woman sound' },
  { voiceId: 'deep',     name: 'Deep',          emoji: '🎭', semitones: -5,  tag: 'low & serious' },
  { voiceId: 'older',    name: 'Older',         emoji: '👴', semitones: -8,  tag: 'older, gruff' },
  { voiceId: 'chipmunk', name: 'Chipmunk',      emoji: '🐿️', semitones:  12, tag: 'intentionally silly' },
  { voiceId: 'demon',    name: 'Demon',         emoji: '😈', semitones: -12, tag: 'one octave down' },
  { voiceId: 'elon',     name: 'Elon Musk',     emoji: '🚀', semitones: -2,  tag: 'low, deliberate' },
  { voiceId: 'collin',   name: 'Collin Raye',   emoji: '🎸', semitones:  3,  tag: 'country tenor' },
]


export default function CallRoomPage({ code, onLeave }) {
  const [audioState, setAudioState] = useState('new')
  const [isMuted, setIsMuted]       = useState(false)
  const [peersCount, setPeersCount] = useState(0)
  const [voiceId, setVoiceId]       = useState('natural')
  const [copied, setCopied]         = useState(false)
  const [timer, setTimer]           = useState(0)
  const [volume, setVolume]         = useState(0)
  const [audioLocked, setAudioLocked] = useState(false)
  const [showTrain, setShowTrain]   = useState(false)
  const [trainName, setTrainName]   = useState('')
  const [trainStatus, setTrainStatus] = useState(null)
  const [trainedVoices, setTrainedVoices] = useState([])
  const [pitchOffset, setPitchOffset] = useState(0)

  const socketRef   = useRef(null)
  const streamRef   = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const pitchRef    = useRef(null)
  const nextPlayRef = useRef(0)
  const timerRef    = useRef(null)
  const rafRef      = useRef(0)
  const mutedRef    = useRef(false)
  const socketSend  = useRef(null)

  const guestUrl    = `${window.location.origin}/guest/${code}`
  const isLive      = audioState === 'live'
  const isFailed    = audioState === 'failed'
  const allVoices   = [...VOICE_MODES, ...trainedVoices]
  const currentVoice = allVoices.find(v => v.voiceId === voiceId) ?? VOICE_MODES[0]

  const fmt = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  useEffect(() => {
    if (isLive) { timerRef.current = setInterval(() => setTimer(t => t+1), 1000) }
    else { clearInterval(timerRef.current); setTimer(0) }
    return () => clearInterval(timerRef.current)
  }, [isLive])

  // Update pitch live — Tone.js PitchShift.pitch is hot-swappable, no restart needed
  // Total pitch = preset semitones + user's fine-tune offset
  useEffect(() => {
    const mode = allVoices.find(v => v.voiceId === voiceId) ?? VOICE_MODES[0]
    if (pitchRef.current) pitchRef.current.pitch = (mode.semitones ?? 0) + pitchOffset
  }, [voiceId, pitchOffset, trainedVoices])

  const f32ToB64 = arr => {
    const b = new Uint8Array(arr.buffer); let s = ''
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
    return btoa(s)
  }
  const b64ToF32 = b64 => {
    const s = atob(b64); const b = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i)
    return new Float32Array(b.buffer)
  }

  const unlockAudio = useCallback(async () => {
    const ctx = audioCtxRef.current; if (!ctx) return
    if (ctx.state === 'suspended') { try { await ctx.resume() } catch {} }
    setAudioLocked(ctx.state === 'suspended')
  }, [])

  const playChunk = useCallback((floats, sr) => {
    const ctx = audioCtxRef.current; if (!ctx) return
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); setAudioLocked(true); return }
    setAudioLocked(false)
    try {
      const buf = ctx.createBuffer(1, floats.length, sr)
      buf.copyToChannel(floats, 0)
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination)
      const now = ctx.currentTime
      const startAt = Math.max(now + 0.04, Math.min(nextPlayRef.current, now + 0.3))
      src.start(startAt); nextPlayRef.current = startAt + buf.duration
    } catch {}
  }, [])

  useEffect(() => {
    if (!code) return
    let active = true

    const setup = async () => {
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        })
      } catch { setAudioState('failed'); return }
      if (!active) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream

      // Use Tone.js — same engine as VoiceChangerPage's "Girl" voice (proven to sound natural)
      const Tone = await import('tone')
      await Tone.start()
      const ctx = Tone.getContext().rawContext
      audioCtxRef.current = ctx

      const unlock = async () => {
        if (ctx.state === 'suspended') { try { await ctx.resume() } catch {} }
        setAudioLocked(ctx.state === 'suspended')
      }
      setAudioLocked(ctx.state === 'suspended')
      document.addEventListener('touchstart', unlock, { once: true })
      document.addEventListener('click', unlock, { once: true })

      const micSrc  = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyserRef.current = analyser
      micSrc.connect(analyser)

      const tick = () => {
        rafRef.current = requestAnimationFrame(tick)
        const d = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(d)
        setVolume(d.reduce((a, b) => a + b, 0) / d.length / 255)
      }
      tick()

      // Gain node for mute control
      const gainNode = ctx.createGain(); gainNode.gain.value = 1
      micSrc.connect(gainNode)

      // Tone.js PitchShift: proper phase vocoder — pitch changes, speech speed stays the same
      // pitch: 8 semitones for Female = same as VoiceChangerPage "Girl" which sounds like a real woman
      const currentMode = VOICE_MODES.find(v => v.voiceId === voiceId) ?? VOICE_MODES[0]
      const pitchShift = new Tone.PitchShift({ pitch: currentMode.semitones, windowSize: 0.1, delayTime: 0, feedback: 0 })
      pitchRef.current = pitchShift
      gainNode.connect(pitchShift.input)

      // Bridge Tone.js output → native ScriptProcessor via MediaStreamDestination.
      // Direct pitchShift.connect(scriptProcessor) is unreliable across Tone.js versions —
      // MediaStreamDestination is the correct native bridge.
      const msDest = ctx.createMediaStreamDestination()
      pitchShift.connect(msDest)              // Tone → native MediaStreamDestination
      const capturedSrc = ctx.createMediaStreamSource(msDest.stream) // re-source the stream
      const capturer = ctx.createScriptProcessor(4096, 1, 1)
      const silentGain = ctx.createGain(); silentGain.gain.value = 0
      capturedSrc.connect(capturer)
      capturer.connect(silentGain)
      silentGain.connect(ctx.destination)     // must be in graph for onaudioprocess to fire

      const socket = io({ path: '/api/socket.io', transports: ['websocket', 'polling'] })
      socketRef.current = socket
      socketSend.current = socket

      capturer.onaudioprocess = (e) => {
        if (!active || !socket.connected || mutedRef.current) return
        socket.emit('audio-chunk', {
          roomCode: code,
          chunk: f32ToB64(new Float32Array(e.inputBuffer.getChannelData(0))),
          sampleRate: ctx.sampleRate
        })
      }

      socket.on('connect',     () => { setAudioState('connecting'); socket.emit('join-room', code) })
      socket.on('disconnect',  () => { if (active) setAudioState('failed') })
      socket.on('room-peers',  ids => { setPeersCount(ids.length); if (ids.length > 0) setAudioState('live') })
      socket.on('peer-joined', () => { setPeersCount(n => n + 1); setAudioState('live') })
      socket.on('peer-left',   () => setPeersCount(n => Math.max(0, n - 1)))
      socket.on('audio-chunk', ({ chunk, sampleRate }) => {
        try { playChunk(b64ToF32(chunk), sampleRate || ctx.sampleRate) } catch {}
      })
    }

    setup()
    return () => {
      active = false
      cancelAnimationFrame(rafRef.current)
      clearInterval(timerRef.current)
      try { pitchRef.current?.dispose() } catch {}
      socketRef.current?.emit('leave-room', code)
      socketRef.current?.disconnect()
      streamRef.current?.getTracks().forEach(t => t.stop())
      try { audioCtxRef.current?.close() } catch {}
    }
  }, [code])

  const toggleMute = () => {
    const next = !isMuted; setIsMuted(next); mutedRef.current = next
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
  }
  const copyLink = () => {
    navigator.clipboard.writeText(guestUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const handleTrainUpload = async (file) => {
    if (!file || !trainName.trim()) return
    setTrainStatus('busy')
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = e => res(e.target.result.split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const resp = await fetch('/api/call/voice/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: b64, name: trainName.trim(), mimeType: file.type || 'audio/mpeg' })
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error || 'Upload failed')
      const newV = { voiceId: d.voiceId, name: trainName.trim(), emoji: '🌟', semitones: 0, tag: 'your clone' }
      setTrainedVoices(v => [...v, newV])
      setTrainStatus({ ok: true, voiceId: d.voiceId, name: trainName.trim() })
      setTrainName('')
    } catch (e) {
      setTrainStatus({ err: e.message })
    }
  }

  const glowIntensity = isLive && !isMuted ? volume : 0

  return (
    <div className="flex flex-col h-full text-white"
      style={{ background: 'linear-gradient(165deg,#0c0c1a 0%,#130a26 55%,#0c0c1a 100%)' }}>

      {audioLocked && (
        <button onClick={unlockAudio}
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4"
          style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(139,92,246,0.2)', border: '2px solid rgba(139,92,246,0.5)' }}>
            <Volume2 className="w-9 h-9 text-purple-400" />
          </div>
          <div className="text-center px-8">
            <p className="text-white font-bold text-lg">Tap to Enable Audio</p>
            <p className="text-gray-400 text-sm mt-1">Browser requires a tap before audio can start</p>
          </div>
        </button>
      )}

      <style>{`
        @keyframes ring-pulse  { 0%,100%{transform:scale(1);opacity:.5}  50%{transform:scale(1.07);opacity:.15} }
        @keyframes ring-pulse-2{ 0%,100%{transform:scale(1);opacity:.3}  50%{transform:scale(1.12);opacity:.08} }
        .no-scrollbar::-webkit-scrollbar{display:none}
        .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}
      `}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2">
        <button onClick={onLeave}
          className="w-9 h-9 flex items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.06)' }}>
          <ChevronLeft className="w-5 h-5 text-gray-400" />
        </button>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-gray-600 font-mono">Private Call</p>
          <p className="text-sm font-bold tracking-widest text-purple-400 font-mono">{code}</p>
        </div>
        <div className="w-9" />
      </div>

      {/* Avatar + glow ring — compact, not flex-1 so voice+controls always fit */}
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-3">
        <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            boxShadow: `0 0 ${50 + glowIntensity * 80}px ${15 + glowIntensity * 40}px rgba(139,92,246,${0.08 + glowIntensity * 0.28})`,
            transition: 'box-shadow 0.1s ease'
          }} />
          <div className="absolute rounded-full pointer-events-none" style={{
            width: 168, height: 168,
            border: `1.5px solid rgba(139,92,246,${isLive ? 0.3 : 0.07})`,
            animation: 'ring-pulse 2.4s ease-in-out infinite'
          }} />
          <div className="absolute rounded-full pointer-events-none" style={{
            width: 188, height: 188,
            border: `1px solid rgba(139,92,246,${isLive ? 0.18 : 0.04})`,
            animation: 'ring-pulse-2 2.4s ease-in-out 0.8s infinite'
          }} />
          <div className="relative w-36 h-36 rounded-full flex items-center justify-center select-none" style={{
            background: 'linear-gradient(145deg,#1e1535,#2d1c56)',
            border: '1.5px solid rgba(139,92,246,0.4)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)'
          }}>
            <span className="text-5xl">{currentVoice?.emoji ?? '🎙️'}</span>
          </div>
        </div>

        <div className="text-center">
          <p className="text-white font-semibold text-xl tracking-tight">{currentVoice?.name ?? 'Natural'}</p>
          <p className="text-[11px] text-purple-400/60 font-mono mt-0.5">
            {currentVoice?.tag ?? 'real voice'} · local · instant · no cracking
          </p>
        </div>

        {isLive ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-xs font-mono font-semibold">LIVE · {fmt(timer)}</span>
            </div>
            {peersCount > 0 && (
              <div className="flex items-center gap-1 text-gray-600 text-xs">
                <Users className="w-3 h-3" /><span>{peersCount}</span>
              </div>
            )}
          </div>
        ) : isFailed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-red-400 text-xs font-mono font-semibold">DISCONNECTED</span>
            </div>
            <button onClick={onLeave}
              className="px-4 py-1.5 rounded-full text-xs font-semibold text-white"
              style={{ background: 'rgba(139,92,246,0.8)' }}>🔄 Restart</button>
          </div>
        ) : audioState === 'connecting' ? (
          <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5 animate-pulse"
            style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
            <span className="text-yellow-400 text-xs font-mono font-semibold">
              {peersCount > 0 ? `CONNECTED · ${peersCount} IN ROOM` : 'WAITING FOR GUEST…'}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5 animate-pulse"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span className="text-indigo-400 text-xs font-mono font-semibold">STARTING MIC…</span>
          </div>
        )}

        <button onClick={copyLink}
          className="w-full max-w-sm flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-xs text-gray-500 font-mono truncate">
            {guestUrl.replace(/https?:\/\//, '')}
          </span>
          <span className={`flex items-center gap-1.5 text-xs font-semibold flex-shrink-0 ${copied ? 'text-green-400' : 'text-purple-400'}`}>
            {copied ? <><Check className="w-3.5 h-3.5" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy Link</>}
          </span>
        </button>
      </div>

      {/* Voice selector — scrollable so controls stay visible on small screens */}
      <div className="px-4 pb-2 overflow-y-auto flex-1 no-scrollbar">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest text-gray-600 font-mono">
            Voice Effects · local · instant
          </p>
          <button
            onClick={() => { setShowTrain(t => !t); setTrainStatus(null) }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all"
            style={showTrain
              ? { background: 'rgba(139,92,246,0.3)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.5)' }
              : { background: 'rgba(255,255,255,0.06)', color: 'rgba(156,163,175,1)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Upload className="w-2.5 h-2.5" /> Train Voice
          </button>
        </div>

        {/* Voice training panel */}
        {showTrain && (
          <div className="mb-3 rounded-2xl p-3 space-y-2"
            style={{ background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.2)' }}>
            <p className="text-[11px] text-purple-300 font-semibold">Clone your voice with ElevenLabs</p>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Upload 1–10 min of clean speech (MP3 / WAV). Creates a voice clone for your WhatsApp bot TTS replies.
              Requires your ELEVENLABS_API_KEY secret to be set.
            </p>
            <input
              value={trainName}
              onChange={e => setTrainName(e.target.value)}
              placeholder="Voice name (e.g. My Clone)"
              className="w-full bg-transparent rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 outline-none"
              style={{ border: '1px solid rgba(139,92,246,0.35)' }}
            />
            <label
              className={`flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all select-none ${(!trainName.trim() || trainStatus === 'busy') ? 'opacity-40 pointer-events-none' : ''}`}
              style={{ background: 'rgba(139,92,246,0.4)', border: '1px solid rgba(139,92,246,0.6)', color: '#e9d5ff' }}>
              <Upload className="w-3.5 h-3.5" />
              {trainStatus === 'busy' ? 'Uploading to ElevenLabs…' : 'Choose audio file & upload'}
              <input
                type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg" className="hidden"
                disabled={!trainName.trim() || trainStatus === 'busy'}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleTrainUpload(f); e.target.value = '' }}
              />
            </label>
            {trainStatus && trainStatus !== 'busy' && (
              <div className={`text-[11px] px-3 py-2 rounded-lg font-mono leading-relaxed ${trainStatus.ok ? 'text-green-400 bg-green-900/20' : 'text-red-400 bg-red-900/20'}`}>
                {trainStatus.ok
                  ? `✅ "${trainStatus.name}" trained!\nVoice ID: ${trainStatus.voiceId}\nUse .voice on in WhatsApp to activate bot TTS with this voice.`
                  : `❌ ${trainStatus.err}`}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {allVoices.map(v => {
            const sel = voiceId === v.voiceId
            return (
              <button key={v.voiceId} onClick={() => { setVoiceId(v.voiceId); setPitchOffset(0) }}
                className="flex-shrink-0 flex flex-col items-center gap-1 rounded-2xl px-3 py-2.5 min-w-[72px] transition-all"
                style={sel
                  ? { background: 'rgba(139,92,246,0.2)', border: '1.5px solid rgba(139,92,246,0.7)' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-2xl leading-none">{v.emoji}</span>
                <span className={`text-[10px] font-semibold mt-0.5 ${sel ? 'text-purple-300' : 'text-gray-400'}`}>
                  {v.name}
                </span>
                <span className={`text-[9px] ${sel ? 'text-purple-500' : 'text-gray-700'}`}>
                  {v.tag}
                </span>
              </button>
            )
          })}
        </div>

        {/* Pitch fine-tune slider */}
        <div className="mt-3 rounded-2xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-600 font-mono">Pitch Fine-Tune</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold"
                style={{ color: pitchOffset === 0 ? 'rgba(156,163,175,1)' : pitchOffset > 0 ? '#a78bfa' : '#60a5fa' }}>
                {pitchOffset > 0 ? `+${pitchOffset}` : pitchOffset} st
              </span>
              {pitchOffset !== 0 && (
                <button onClick={() => setPitchOffset(0)}
                  className="text-[9px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(156,163,175,1)' }}>
                  reset
                </button>
              )}
            </div>
          </div>
          <input
            type="range" min="-12" max="12" step="1"
            value={pitchOffset}
            onChange={e => setPitchOffset(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #7c3aed ${((pitchOffset + 12) / 24) * 100}%, rgba(255,255,255,0.1) ${((pitchOffset + 12) / 24) * 100}%)`
            }}
          />
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-gray-700 font-mono">-12 (lower)</span>
            <span className="text-[9px] text-gray-700 font-mono">0</span>
            <span className="text-[9px] text-gray-700 font-mono">+12 (higher)</span>
          </div>
        </div>
      </div>

      {/* Controls — flex-shrink-0 so they're always visible at the bottom */}
      <div className="flex-shrink-0 flex items-center justify-center gap-8 px-6 py-5"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <button onClick={toggleMute}
          className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
          style={isMuted
            ? { background: 'rgba(239,68,68,0.15)', border: '1.5px solid rgba(239,68,68,0.4)' }
            : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {isMuted ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5 text-gray-300" />}
        </button>
        <button onClick={onLeave}
          className="w-16 h-16 rounded-full flex items-center justify-center text-white transition-all"
          style={{ background: '#dc2626', boxShadow: '0 8px 32px rgba(220,38,38,0.4)' }}>
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  )
}
