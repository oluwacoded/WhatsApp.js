import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Mic, MicOff, PhoneOff, Copy, Check, ChevronLeft, Users, Play, Square } from 'lucide-react'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80',   username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

const DEFAULT_VOICES = [
  { voiceId: 'natural',              name: 'Natural',    emoji: '🎙️', description: 'Your real voice' },
  { voiceId: 'pNInz6obpgDQGcFmaJgB', name: 'Deep Male', emoji: '🎭', description: 'Low, authoritative' },
  { voiceId: 'TxGEqnHWrfWFTfGW9XjX', name: 'Casual',   emoji: '💬', description: 'Young, relaxed' },
  { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Warm',     emoji: '🌸', description: 'Soft, intimate' },
  { voiceId: '21m00Tcm4TlvDq8ikWAM', name: 'Clear',    emoji: '✨', description: 'Crisp, professional' },
]

export default function CallRoomPage({ code, onLeave }) {
  const [iceState, setIceState]       = useState('new')
  const [isMuted, setIsMuted]         = useState(false)
  const [peersCount, setPeersCount]   = useState(0)
  const [voiceId, setVoiceId]         = useState('natural')
  const [baseVoices, setBaseVoices]   = useState(DEFAULT_VOICES)
  const [celebVoices, setCelebVoices] = useState([])
  const [activeTab, setActiveTab]     = useState('base')
  const [copied, setCopied]           = useState(false)
  const [timer, setTimer]             = useState(0)
  const [volume, setVolume]           = useState(0)
  const [previewing, setPreviewing]   = useState(null)

  const socketRef    = useRef(null)
  const peersRef     = useRef(new Map())
  const streamRef    = useRef(null)
  const processedRef = useRef(null)
  const audioCtxRef  = useRef(null)
  const analyserRef  = useRef(null)
  const audioRefs    = useRef(new Map())
  const processorRef = useRef(null)
  const sampleBufRef = useRef([])
  const transformRef = useRef(false)
  const iceQueueRef  = useRef(new Map())
  const timerRef     = useRef(null)
  const rafRef       = useRef(0)
  const previewRef   = useRef(null)

  const guestUrl = `${window.location.origin}/guest/${code}`
  const isLive   = iceState === 'connected' || iceState === 'completed'
  const isFailed = iceState === 'failed' || iceState === 'disconnected'

  const copyLink = () => {
    navigator.clipboard.writeText(guestUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  useEffect(() => {
    fetch('/api/call/voices/base').then(r => r.json())
      .then(d => { if (d.voices?.length) setBaseVoices(d.voices) }).catch(() => {})
    fetch('/api/call/voices/celebrity').then(r => r.json())
      .then(d => { if (d.voices?.length) setCelebVoices(d.voices) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (isLive) {
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000)
    } else {
      clearInterval(timerRef.current); setTimer(0)
    }
    return () => clearInterval(timerRef.current)
  }, [isLive])

  const encodeWAV = (samples, sr) => {
    const buf = new ArrayBuffer(44 + samples.length * 2)
    const v = new DataView(buf)
    const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
    ws(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true)
    ws(36, 'data'); v.setUint32(40, samples.length * 2, true)
    let off = 44
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2
    }
    return buf
  }

  const initAudio = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, video: false
      })
      streamRef.current = stream
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyserRef.current = analyser
      const dest = ctx.createMediaStreamDestination(); processedRef.current = dest.stream
      src.connect(analyser).connect(dest)
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick)
        const data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
        setVolume(data.reduce((a, b) => a + b, 0) / data.length / 255)
      }
      tick()
      return true
    } catch { return false }
  }, [])

  const stopCelebTransform = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current.onaudioprocess = null
      processorRef.current = null
    }
    sampleBufRef.current = []; transformRef.current = false
  }, [])

  const startCelebTransform = useCallback((vid) => {
    if (!audioCtxRef.current || !streamRef.current) return
    const ctx = audioCtxRef.current; const sr = ctx.sampleRate
    const chunkSamples = Math.floor(sr * 2.0)
    const src = ctx.createMediaStreamSource(streamRef.current)
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    const dest = ctx.createMediaStreamDestination()
    src.connect(analyserRef.current); src.connect(proc); proc.connect(ctx.destination)
    sampleBufRef.current = []; let total = 0
    proc.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0)
      sampleBufRef.current.push(new Float32Array(ch)); total += ch.length
      if (total >= chunkSamples && !transformRef.current) {
        transformRef.current = true
        const combined = new Float32Array(total); let off = 0
        for (const c of sampleBufRef.current) { combined.set(c, off); off += c.length }
        sampleBufRef.current = []; total = 0
        fetch('/api/call/voice/transform', {
          method: 'POST', headers: { 'Content-Type': 'audio/wav', 'x-voice-id': vid },
          body: encodeWAV(combined, sr)
        }).then(async r => {
          if (!r.ok) throw new Error()
          const decoded = await ctx.decodeAudioData(await r.arrayBuffer())
          const bs = ctx.createBufferSource(); bs.buffer = decoded; bs.connect(dest); bs.start()
        }).catch(() => {}).finally(() => { transformRef.current = false })
      }
    }
    processorRef.current = proc
    const track = dest.stream.getAudioTracks()[0]
    if (track) {
      processedRef.current = dest.stream
      peersRef.current.forEach(pc => {
        const s = pc.getSenders().find(s => s.track?.kind === 'audio')
        if (s) s.replaceTrack(track)
      })
    }
  }, [])

  const handleVoiceChange = useCallback(async (vid) => {
    setVoiceId(vid); stopCelebTransform()
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    const ok = await initAudio(); if (!ok) return
    if (vid !== 'natural') {
      startCelebTransform(vid)
    } else {
      if (audioCtxRef.current && streamRef.current) {
        const ctx = audioCtxRef.current
        const src = ctx.createMediaStreamSource(streamRef.current)
        const dest = ctx.createMediaStreamDestination(); processedRef.current = dest.stream
        src.connect(analyserRef.current).connect(dest)
        const track = dest.stream.getAudioTracks()[0]
        if (track) peersRef.current.forEach(pc => {
          const s = pc.getSenders().find(s => s.track?.kind === 'audio')
          if (s) s.replaceTrack(track)
        })
      }
    }
    socketRef.current?.emit('voice-mode-change', { roomCode: code, mode: vid })
  }, [code, initAudio, startCelebTransform, stopCelebTransform])

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

  useEffect(() => {
    if (!code) return
    let active = true
    const setup = async () => {
      const ok = await initAudio(); if (!ok || !active) return
      const socket = io({ path: '/api/socket.io' }); socketRef.current = socket
      socket.on('connect',    () => socket.emit('join-room', code))
      socket.on('disconnect', () => setIceState('disconnected'))

      const createPeer = (targetId) => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceTransportPolicy: 'all' })
        processedRef.current?.getTracks().forEach(t => pc.addTrack(t, processedRef.current))
        pc.onicecandidate = (e) => { if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, targetId }) }
        pc.oniceconnectionstatechange = () => setIceState(pc.iceConnectionState)
        pc.ontrack = (e) => {
          let el = audioRefs.current.get(targetId)
          if (!el) {
            el = document.createElement('audio')
            el.autoplay = true; el.setAttribute('playsinline', '')
            document.body.appendChild(el)
            audioRefs.current.set(targetId, el)
          }
          el.srcObject = e.streams[0]; el.play().catch(() => {})
        }
        peersRef.current.set(targetId, pc); return pc
      }

      const drain = async (pc, targetId) => {
        const q = iceQueueRef.current.get(targetId) ?? []; iceQueueRef.current.delete(targetId)
        for (const c of q) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
      }

      socket.on('room-peers',  (ids) => { setPeersCount(ids.length); ids.forEach(id => createPeer(id)) })
      socket.on('peer-joined', async (targetId) => {
        setPeersCount(n => n + 1); const pc = createPeer(targetId)
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
        socket.emit('webrtc-offer', { offer, targetId })
      })
      socket.on('webrtc-offer', async ({ offer, targetId }) => {
        let pc = peersRef.current.get(targetId); if (!pc) pc = createPeer(targetId)
        if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') return
        await pc.setRemoteDescription(new RTCSessionDescription(offer)); await drain(pc, targetId)
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer)
        socket.emit('webrtc-answer', { answer, targetId })
      })
      socket.on('webrtc-answer', async ({ answer, targetId }) => {
        const pc = peersRef.current.get(targetId)
        if (pc && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(answer)); await drain(pc, targetId)
        }
      })
      socket.on('ice-candidate', async ({ candidate, targetId }) => {
        const pc = peersRef.current.get(targetId)
        if (!pc?.remoteDescription) {
          const q = iceQueueRef.current.get(targetId) ?? []
          q.push(candidate); iceQueueRef.current.set(targetId, q); return
        }
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
      })
      socket.on('peer-left', (targetId) => {
        setPeersCount(n => Math.max(0, n - 1))
        peersRef.current.get(targetId)?.close(); peersRef.current.delete(targetId)
        const el = audioRefs.current.get(targetId)
        if (el) { el.srcObject = null; el.remove(); audioRefs.current.delete(targetId) }
      })
    }
    setup()
    return () => {
      active = false; stopCelebTransform()
      cancelAnimationFrame(rafRef.current)
      clearInterval(timerRef.current)
      socketRef.current?.emit('leave-room', code); socketRef.current?.disconnect()
      peersRef.current.forEach(pc => pc.close()); peersRef.current.clear()
      audioRefs.current.forEach(el => { el.srcObject = null; el.remove() }); audioRefs.current.clear()
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
    }
  }, [code])

  const toggleMute = () => {
    const next = !isMuted; setIsMuted(next)
    processedRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
  }

  const currentVoice = [...baseVoices, ...celebVoices].find(v => v.voiceId === voiceId)
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

        {/* Avatar with glow rings */}
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
          {voiceId !== 'natural' && (
            <p className="text-[11px] text-purple-400 font-mono mt-1 flex items-center gap-1.5 justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              AI Voice Active · ~2s delay
            </p>
          )}
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
          <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
            <span className="text-red-400 text-xs font-mono font-semibold">CONNECTION FAILED — Refresh</span>
          </div>
        ) : peersCount > 0 ? (
          <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5 animate-pulse"
            style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
            <span className="text-yellow-400 text-xs font-mono font-semibold">CONNECTING AUDIO…</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5 animate-pulse"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span className="text-indigo-400 text-xs font-mono font-semibold">WAITING FOR GUEST…</span>
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

      {/* Voice selector */}
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
              <button key={v.voiceId} onClick={() => handleVoiceChange(v.voiceId)}
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
