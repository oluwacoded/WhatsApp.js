import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Mic, MicOff, PhoneOff, Copy, Check, ChevronLeft, Users, Play, Square } from 'lucide-react'

const DEFAULT_VOICES = [
  { voiceId: 'natural',              name: 'Natural',    emoji: '🎙️', description: 'Your real voice' },
  { voiceId: 'pNInz6obpgDQGcFmaJgB', name: 'Deep Male', emoji: '🎭', description: 'Low, authoritative' },
  { voiceId: 'TxGEqnHWrfWFTfGW9XjX', name: 'Casual',   emoji: '💬', description: 'Young, relaxed' },
  { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Warm',     emoji: '🌸', description: 'Soft, intimate' },
  { voiceId: '21m00Tcm4TlvDq8ikWAM', name: 'Clear',    emoji: '✨', description: 'Crisp, professional' },
]

export default function CallRoomPage({ code, onLeave }) {
  const [audioState, setAudioState] = useState('new')  // new|connecting|live|failed
  const [isMuted, setIsMuted]       = useState(false)
  const [peersCount, setPeersCount] = useState(0)
  const [voiceId, setVoiceId]       = useState('natural')
  const [baseVoices, setBaseVoices] = useState(DEFAULT_VOICES)
  const [celebVoices, setCelebVoices] = useState([])
  const [activeTab, setActiveTab]   = useState('base')
  const [copied, setCopied]         = useState(false)
  const [timer, setTimer]           = useState(0)
  const [volume, setVolume]         = useState(0)
  const [previewing, setPreviewing] = useState(null)

  const socketRef    = useRef(null)
  const streamRef    = useRef(null)
  const audioCtxRef  = useRef(null)
  const analyserRef  = useRef(null)
  const processorRef = useRef(null)
  const nextPlayRef  = useRef(0)
  const timerRef     = useRef(null)
  const rafRef       = useRef(0)
  const mutedRef     = useRef(false)
  const previewRef   = useRef(null)
  const voiceIdRef   = useRef('natural')   // live-updated by voice selector
  const chunkBufRef  = useRef([])          // accumulates Float32 samples for STS batching

  const guestUrl = `${window.location.origin}/guest/${code}`
  const isLive   = audioState === 'live'
  const isFailed = audioState === 'failed'

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  useEffect(() => {
    fetch('/api/call/voices/base').then(r => r.json())
      .then(d => { if (d.voices?.length) setBaseVoices(d.voices) }).catch(() => {})
    fetch('/api/call/voices/celebrity').then(r => r.json())
      .then(d => { if (d.voices?.length) setCelebVoices(d.voices) }).catch(() => {})
  }, [])

  // Keep ref in sync so onaudioprocess can read it without stale closure
  useEffect(() => { voiceIdRef.current = voiceId; chunkBufRef.current = [] }, [voiceId])

  useEffect(() => {
    if (isLive) {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000)
    } else {
      clearInterval(timerRef.current); setTimer(0)
    }
    return () => clearInterval(timerRef.current)
  }, [isLive])

  const playChunk = useCallback((floats, sampleRate) => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    try {
      const buf = ctx.createBuffer(1, floats.length, sampleRate)
      buf.copyToChannel(floats, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      const now = ctx.currentTime
      const startAt = Math.max(now + 0.05, nextPlayRef.current)
      src.start(startAt)
      nextPlayRef.current = startAt + buf.duration
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

      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume()

      // Volume analyser for glow effect
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyserRef.current = analyser
      src.connect(analyser)
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick)
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        setVolume(data.reduce((a, b) => a + b, 0) / data.length / 255)
      }
      tick()

      const socket = io({ path: '/api/socket.io', transports: ['websocket', 'polling'] })
      socketRef.current = socket

      socket.on('connect', () => {
        setAudioState('connecting')
        socket.emit('join-room', code)

        // ScriptProcessor captures mic audio and sends over socket.io
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        processorRef.current = processor

        // Batch threshold: ~1.5 seconds of audio
        const BATCH_SAMPLES = Math.round(ctx.sampleRate * 1.5)

        processor.onaudioprocess = (e) => {
          if (!active || !socket.connected) return
          if (mutedRef.current) return
          const raw = e.inputBuffer.getChannelData(0)
          const vid = voiceIdRef.current

          if (vid === 'natural') {
            // Natural voice: relay raw chunks immediately, low latency
            const copy = new Float32Array(raw)
            socket.emit('audio-chunk', { roomCode: code, chunk: copy.buffer, sampleRate: ctx.sampleRate })
          } else {
            // Voice transform mode: accumulate until batch is large enough
            chunkBufRef.current.push(new Float32Array(raw))
            const totalSamples = chunkBufRef.current.reduce((n, f) => n + f.length, 0)
            if (totalSamples >= BATCH_SAMPLES) {
              const merged = new Float32Array(totalSamples)
              let offset = 0
              for (const f of chunkBufRef.current) { merged.set(f, offset); offset += f.length }
              chunkBufRef.current = []
              socket.emit('voice-chunk-batch', { roomCode: code, chunk: merged.buffer, sampleRate: ctx.sampleRate, voiceId: vid })
            }
          }
        }

        // Silent gain keeps graph active without echoing mic back to speaker
        const silentGain = ctx.createGain(); silentGain.gain.value = 0
        src.connect(processor)
        processor.connect(silentGain)
        silentGain.connect(ctx.destination)
      })

      socket.on('disconnect', () => {
        if (active) setAudioState('failed')
      })

      socket.on('room-peers', (ids) => {
        setPeersCount(ids.length)
      })

      socket.on('peer-joined', () => {
        setPeersCount(n => n + 1)
        setAudioState('live')
      })

      socket.on('peer-left', () => {
        setPeersCount(n => Math.max(0, n - 1))
      })

      socket.on('audio-chunk', ({ chunk, sampleRate }) => {
        try {
          const floats = new Float32Array(chunk)
          playChunk(floats, sampleRate || ctx.sampleRate)
        } catch {}
      })
    }

    setup()
    return () => {
      active = false
      cancelAnimationFrame(rafRef.current)
      clearInterval(timerRef.current)
      processorRef.current?.disconnect()
      socketRef.current?.emit('leave-room', code)
      socketRef.current?.disconnect()
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
    }
  }, [code])

  const toggleMute = () => {
    const next = !isMuted; setIsMuted(next)
    mutedRef.current = next
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
  }

  const handlePreview = useCallback(async (vid, e) => {
    e.stopPropagation()
    if (previewRef.current) { previewRef.current.pause(); previewRef.current = null }
    if (previewing === vid) { setPreviewing(null); return }
    setPreviewing(vid)
    try {
      const r = await fetch(`/api/call/voice/preview/${vid}`)
      if (!r.ok) throw new Error()
      const url = URL.createObjectURL(await r.blob())
      const audio = new Audio(url); previewRef.current = audio
      audio.onended = () => { setPreviewing(null); URL.revokeObjectURL(url) }
      audio.onerror = () => { setPreviewing(null); URL.revokeObjectURL(url) }
      await audio.play()
    } catch { setPreviewing(null) }
  }, [previewing])

  const copyLink = () => {
    navigator.clipboard.writeText(guestUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const currentVoice = [...baseVoices, ...celebVoices].find(v => v.voiceId === voiceId) ?? DEFAULT_VOICES[0]
  const glowIntensity = isLive && !isMuted ? volume : 0

  return (
    <div className="flex flex-col h-full text-white overflow-hidden"
      style={{ background: 'linear-gradient(165deg,#0c0c1a 0%,#130a26 55%,#0c0c1a 100%)' }}>

      <style>{`
        @keyframes ring-pulse {
          0%,100% { transform:scale(1); opacity:0.5; }
          50%      { transform:scale(1.07); opacity:0.15; }
        }
        @keyframes ring-pulse-2 {
          0%,100% { transform:scale(1); opacity:0.3; }
          50%      { transform:scale(1.12); opacity:0.08; }
        }
        .no-scrollbar::-webkit-scrollbar { display:none; }
        .no-scrollbar { -ms-overflow-style:none; scrollbar-width:none; }
      `}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2">
        <button onClick={onLeave}
          className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)' }}>
          <ChevronLeft className="w-5 h-5 text-gray-400" />
        </button>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-gray-600 font-mono">Private Call</p>
          <p className="text-sm font-bold tracking-widest text-purple-400 font-mono">{code}</p>
        </div>
        <div className="w-9" />
      </div>

      {/* Avatar + status */}
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">

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

        {/* Voice label */}
        <div className="text-center">
          <p className="text-white font-semibold text-xl tracking-tight">{currentVoice?.name ?? 'Natural'}</p>
          <p className="text-[11px] text-purple-400/60 font-mono mt-0.5">Voice preview only · relay mode</p>
        </div>

        {/* Status pill */}
        {isLive ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-xs font-mono font-semibold">LIVE · {formatTime(timer)}</span>
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
              style={{ background: 'rgba(139,92,246,0.8)' }}>
              🔄 Restart Call
            </button>
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

        {/* Copy guest link */}
        <button onClick={copyLink}
          className="w-full max-w-sm flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-all"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-xs text-gray-500 font-mono truncate">{guestUrl.replace(/https?:\/\//, '')}</span>
          <span className={`flex items-center gap-1.5 text-xs font-semibold flex-shrink-0 transition-colors ${copied ? 'text-green-400' : 'text-purple-400'}`}>
            {copied ? <><Check className="w-3.5 h-3.5" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy Link</>}
          </span>
        </button>
      </div>

      {/* Voice selector (preview only) */}
      <div className="px-4 pb-2">
        <div className="flex gap-1.5 mb-2.5">
          {['base', 'celebrity'].map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className="px-3 py-1 rounded-full text-[11px] font-semibold transition-all"
              style={activeTab === t
                ? { background: 'rgba(139,92,246,0.9)', color: '#fff' }
                : { background: 'rgba(255,255,255,0.06)', color: 'rgba(156,163,175,1)' }}>
              {t === 'celebrity' ? '⭐ Celebrity' : '🎙️ Base'}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {(activeTab === 'base' ? baseVoices : celebVoices.filter(v => !v.pending)).map(v => {
            const sel = voiceId === v.voiceId
            return (
              <button key={v.voiceId} onClick={() => setVoiceId(v.voiceId)}
                className="flex-shrink-0 flex flex-col items-center gap-1 rounded-2xl px-3 py-2.5 transition-all min-w-[68px]"
                style={sel
                  ? { background: 'rgba(139,92,246,0.2)', border: '1.5px solid rgba(139,92,246,0.7)' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="text-2xl leading-none">{v.emoji}</span>
                <span className={`text-[10px] font-medium mt-0.5 ${sel ? 'text-purple-300' : 'text-gray-500'}`}>
                  {(v.name ?? '').split(' ')[0]}
                </span>
                {v.voiceId !== 'natural' && (
                  <button onClick={(e) => handlePreview(v.voiceId, e)}
                    className="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
                    style={{ background: 'rgba(0,0,0,0.3)' }}>
                    {previewing === v.voiceId
                      ? <Square className="w-2 h-2 text-purple-400" />
                      : <Play className="w-2 h-2 text-gray-500" />}
                  </button>
                )}
              </button>
            )
          })}
          {activeTab === 'celebrity' && celebVoices.filter(v => !v.pending).length === 0 && (
            <p className="text-gray-700 text-xs py-4 px-2 animate-pulse">Loading…</p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-8 px-6 py-5"
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
