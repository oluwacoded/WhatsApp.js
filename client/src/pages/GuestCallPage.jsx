import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Mic, MicOff, PhoneOff, Lock, Volume2 } from 'lucide-react'

export default function GuestCallPage() {
  const code = window.location.pathname.split('/').pop()

  const [room, setRoom]             = useState(null)
  const [notFound, setNotFound]     = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted]       = useState(false)
  const [peersCount, setPeersCount] = useState(0)
  const [hasLeft, setHasLeft]       = useState(false)
  const [audioState, setAudioState] = useState('new') // new | unlocking | connecting | live | failed
  const [timer, setTimer]           = useState(0)
  const [audioLocked, setAudioLocked] = useState(false) // true = context suspended, needs gesture

  const socketRef    = useRef(null)
  const streamRef    = useRef(null)
  const audioCtxRef  = useRef(null)
  const processorRef = useRef(null)
  const nextPlayRef  = useRef(0)
  const timerRef     = useRef(null)
  const mutedRef     = useRef(false)

  const isLive   = audioState === 'live'
  const isFailed = audioState === 'failed'

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  useEffect(() => {
    fetch(`/api/call/rooms/${code}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null } return r.json() })
      .then(d => { if (d) setRoom(d) })
      .catch(() => setNotFound(true))
  }, [code])

  useEffect(() => {
    if (isLive) {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000)
    } else {
      clearInterval(timerRef.current); setTimer(0)
    }
    return () => clearInterval(timerRef.current)
  }, [isLive])

  // ── Base64 helpers — avoids binary socket.io frames breaking through Replit's proxy ──
  const f32ToB64 = (arr) => {
    const bytes = new Uint8Array(arr.buffer)
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }
  const b64ToF32 = (b64) => {
    const s = atob(b64); const bytes = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
    return new Float32Array(bytes.buffer)
  }

  // ── Unlock AudioContext — must be called from a user gesture ──
  const unlockAudio = useCallback(async () => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    if (ctx.state === 'suspended') {
      try { await ctx.resume() } catch {}
    }
    setAudioLocked(ctx.state === 'suspended')
  }, [])

  const playChunk = useCallback((floats, sampleRate) => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    // Always try to resume — iOS requires this to be retried after user gesture
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
      setAudioLocked(true)
      return // drop this chunk, try next ones after resume
    }
    setAudioLocked(false)
    try {
      const buf = ctx.createBuffer(1, floats.length, sampleRate)
      buf.copyToChannel(floats, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      const now = ctx.currentTime
      // Cap scheduling to max 300ms ahead — prevents jam when chunks burst in
      const capped = Math.min(nextPlayRef.current, now + 0.3)
      const startAt = Math.max(now + 0.04, capped)
      src.start(startAt)
      nextPlayRef.current = startAt + buf.duration
    } catch {}
  }, [])

  useEffect(() => {
    if (!room) return
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

      // Create AudioContext — will be suspended on iOS until user gesture
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx

      // Try to resume immediately (works on desktop, silently fails on iOS)
      try { await ctx.resume() } catch {}
      setAudioLocked(ctx.state === 'suspended')

      // iOS unlock: any touch/click on the page will resume the context
      const iosUnlock = async () => {
        if (ctx.state === 'suspended') {
          try { await ctx.resume() } catch {}
        }
        setAudioLocked(ctx.state === 'suspended')
      }
      document.addEventListener('touchstart', iosUnlock, { once: true })
      document.addEventListener('click', iosUnlock, { once: true })

      const socket = io({ path: '/api/socket.io', transports: ['websocket', 'polling'] })
      socketRef.current = socket

      socket.on('connect', () => {
        setIsConnected(true)
        setAudioState('connecting')
        socket.emit('join-room', code)

        const src = ctx.createMediaStreamSource(stream)
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        processorRef.current = processor

        processor.onaudioprocess = (e) => {
          if (!active || !socket.connected) return
          const raw = e.inputBuffer.getChannelData(0)
          if (mutedRef.current) return
          const copy = new Float32Array(raw)
          socket.emit('audio-chunk', { roomCode: code, chunk: f32ToB64(copy), sampleRate: ctx.sampleRate })
        }

        // Silent gain keeps graph active without echoing mic back to speaker
        const silentGain = ctx.createGain(); silentGain.gain.value = 0
        src.connect(processor)
        processor.connect(silentGain)
        silentGain.connect(ctx.destination)
      })

      socket.on('disconnect', () => {
        setIsConnected(false)
        if (active) setAudioState('failed')
      })

      socket.on('room-peers', (ids) => {
        setPeersCount(ids.length)
        if (ids.length > 0) setAudioState('live')
      })

      socket.on('peer-joined', () => {
        setPeersCount(n => n + 1)
        setAudioState('live')
      })

      socket.on('peer-left', () => {
        setPeersCount(n => Math.max(0, n - 1))
      })

      socket.on('audio-chunk', ({ chunk, sampleRate }) => {
        setAudioState(s => s === 'new' || s === 'connecting' ? 'live' : s)
        try { playChunk(b64ToF32(chunk), sampleRate || ctx.sampleRate) } catch {}
      })

      socket.on('audio-transformed', ({ audio }) => {
        setAudioState(s => s === 'new' || s === 'connecting' ? 'live' : s)
        if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return }
        try {
          const s = atob(audio); const bytes = new Uint8Array(s.length)
          for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
          ctx.decodeAudioData(bytes.buffer.slice(0), (decoded) => {
            const src2 = ctx.createBufferSource(); src2.buffer = decoded; src2.connect(ctx.destination)
            const now = ctx.currentTime
            const capped = Math.min(nextPlayRef.current, now + 0.3)
            const startAt = Math.max(now + 0.04, capped)
            src2.start(startAt); nextPlayRef.current = startAt + decoded.duration
          })
        } catch {}
      })
    }

    setup()
    return () => {
      active = false
      clearInterval(timerRef.current)
      processorRef.current?.disconnect()
      socketRef.current?.emit('leave-room', code)
      socketRef.current?.disconnect()
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
    }
  }, [room])

  const toggleMute = () => {
    const next = !isMuted
    setIsMuted(next)
    mutedRef.current = next
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
  }

  const leaveCall = () => {
    processorRef.current?.disconnect()
    socketRef.current?.emit('leave-room', code)
    socketRef.current?.disconnect()
    streamRef.current?.getTracks().forEach(t => t.stop())
    audioCtxRef.current?.close()
    setHasLeft(true)
  }

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-center px-6">
      <div>
        <div className="text-5xl mb-4">📵</div>
        <h1 className="text-xl font-bold text-white mb-2">Room not found</h1>
        <p className="text-gray-500 text-sm">This call has ended or doesn&apos;t exist.</p>
      </div>
    </div>
  )

  if (!room) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="text-gray-600 text-sm animate-pulse font-mono">Joining…</div>
    </div>
  )

  if (hasLeft) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-center px-6">
      <div>
        <div className="text-5xl mb-4">✅</div>
        <h1 className="text-xl font-bold text-white mb-2">Call ended</h1>
        <p className="text-gray-500 text-sm">You left the room.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col items-center justify-between py-14 px-6"
      style={{ background: 'linear-gradient(165deg,#09090f 0%,#100a1f 55%,#09090f 100%)' }}>

      <style>{`
        @keyframes ring-a { 0%,100%{transform:scale(1);opacity:0.45} 50%{transform:scale(1.07);opacity:0.12} }
        @keyframes ring-b { 0%,100%{transform:scale(1);opacity:0.25} 50%{transform:scale(1.13);opacity:0.06} }
        @keyframes ring-c { 0%,100%{transform:scale(1);opacity:0.12} 50%{transform:scale(1.20);opacity:0.02} }
      `}</style>

      {/* iOS Audio unlock banner */}
      {audioLocked && (
        <button
          onClick={unlockAudio}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
          style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(139,92,246,0.2)', border: '2px solid rgba(139,92,246,0.5)' }}>
            <Volume2 className="w-9 h-9 text-purple-400" />
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-lg">Tap to Enable Audio</p>
            <p className="text-gray-400 text-sm mt-1">Your browser requires a tap to start audio</p>
          </div>
        </button>
      )}

      <div className="text-center">
        <div className="flex items-center gap-1.5 justify-center mb-2">
          <Lock className="w-3 h-3 text-gray-600" />
          <span className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">End-to-end encrypted</span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Private Call</h1>
      </div>

      <div className="flex flex-col items-center gap-6">
        <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            boxShadow: isLive ? '0 0 70px 25px rgba(139,92,246,0.18)' : isFailed ? '0 0 50px 15px rgba(239,68,68,0.12)' : '0 0 50px 10px rgba(80,70,120,0.1)',
            transition: 'box-shadow 0.5s ease'
          }} />
          <div className="absolute rounded-full pointer-events-none" style={{ width:170, height:170, border:`1.5px solid rgba(139,92,246,${isLive?0.35:isFailed?0:0.08})`, animation:'ring-a 2.2s ease-in-out infinite' }} />
          <div className="absolute rounded-full pointer-events-none" style={{ width:192, height:192, border:`1px solid rgba(139,92,246,${isLive?0.2:isFailed?0:0.04})`, animation:'ring-b 2.2s ease-in-out 0.75s infinite' }} />
          <div className="absolute rounded-full pointer-events-none" style={{ width:212, height:212, border:`1px solid rgba(139,92,246,${isLive?0.1:0})`, animation:'ring-c 2.2s ease-in-out 1.5s infinite' }} />
          <div className="relative w-40 h-40 rounded-full flex items-center justify-center" style={{
            background: 'linear-gradient(145deg,#1a1230,#271848)',
            border: `1.5px solid rgba(${isLive?'139,92,246':isFailed?'239,68,68':'90,70,130'},0.4)`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
            transition: 'border-color 0.5s ease'
          }}>
            <span className="text-6xl select-none">🎭</span>
          </div>
        </div>

        <div className="text-center min-h-[60px] flex flex-col items-center justify-center gap-2">
          {isLive ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400 font-semibold text-base">Audio Live</span>
              </div>
              <p className="text-gray-600 text-xs font-mono">{formatTime(timer)}</p>
            </>
          ) : isFailed ? (
            <>
              <p className="text-red-400 font-semibold text-sm">Connection failed</p>
              <button onClick={() => window.location.reload()}
                className="mt-1 px-5 py-2 rounded-full text-xs font-semibold text-white transition-all active:scale-95"
                style={{ background: 'rgba(139,92,246,0.85)', border: '1px solid rgba(139,92,246,0.5)' }}>
                🔄 Tap to Retry
              </button>
            </>
          ) : audioState === 'connecting' ? (
            <>
              <p className="text-yellow-400 text-sm font-medium animate-pulse">Connecting audio…</p>
              <p className="text-gray-700 text-xs">{peersCount > 0 ? `${peersCount} in room` : 'Waiting for host…'}</p>
            </>
          ) : (
            <p className="text-gray-600 text-sm animate-pulse">Joining call…</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5" style={{
          background: isLive ? 'rgba(34,197,94,0.08)' : isFailed ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.06)',
          border: `1px solid rgba(${isLive?'34,197,94':isFailed?'239,68,68':'99,102,241'},0.2)`
        }}>
          <div className={`w-1.5 h-1.5 rounded-full ${isLive?'bg-green-400 animate-pulse':isFailed?'bg-red-400':'bg-indigo-400 animate-pulse'}`} />
          <span className={`text-[11px] font-mono font-semibold ${isLive?'text-green-400':isFailed?'text-red-400':'text-indigo-400'}`}>
            {isLive ? 'CONNECTED' : isFailed ? 'FAILED' : isConnected ? 'CONNECTING' : 'JOINING'}
          </span>
          {peersCount > 0 && !isFailed && (
            <span className="text-gray-700 text-[11px] font-mono ml-1">· {peersCount} in room</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-8">
        <button onClick={toggleMute}
          className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
          style={isMuted
            ? { background:'rgba(239,68,68,0.15)', border:'1.5px solid rgba(239,68,68,0.4)' }
            : { background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)' }}>
          {isMuted ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5 text-gray-300" />}
        </button>
        <button onClick={leaveCall}
          className="w-16 h-16 rounded-full flex items-center justify-center text-white transition-all"
          style={{ background:'#dc2626', boxShadow:'0 8px 32px rgba(220,38,38,0.4)' }}>
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  )
}
