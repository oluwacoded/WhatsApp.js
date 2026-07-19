import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Mic, MicOff, PhoneOff, Play, Square, Sparkles, Copy, Check } from 'lucide-react'

const BASE_VOICES_FALLBACK = [
  { voiceId: 'natural',              name: 'Natural',      emoji: '🎙️', description: 'Your real voice' },
  { voiceId: 'pNInz6obpgDQGcFmaJgB', name: 'Deep Male',   emoji: '🔵', description: 'Low, authoritative' },
  { voiceId: 'TxGEqnHWrfWFTfGW9XjX', name: 'Casual Male', emoji: '💬', description: 'Young, relaxed' },
  { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Warm Female', emoji: '🌸', description: 'Soft, intimate' },
  { voiceId: '21m00Tcm4TlvDq8ikWAM', name: 'Clear Female', emoji: '✨', description: 'Crisp, professional' },
]

export default function CallRoomPage({ code, onLeave }) {
  const [isConnected, setIsConnected]   = useState(false)
  const [isMuted, setIsMuted]           = useState(false)
  const [peersCount, setPeersCount]     = useState(0)
  const [voiceId, setVoiceId]           = useState('natural')
  const [baseVoices, setBaseVoices]     = useState(BASE_VOICES_FALLBACK)
  const [celebVoices, setCelebVoices]   = useState([])
  const [activeTab, setActiveTab]       = useState('base')
  const [celebGender, setCelebGender]   = useState('male')
  const [previewing, setPreviewing]     = useState(null)
  const [copied, setCopied]             = useState(false)
  const [status, setStatus]             = useState('Connecting…')

  const socketRef    = useRef(null)
  const peersRef     = useRef(new Map())
  const streamRef    = useRef(null)
  const processedRef = useRef(null)
  const audioCtxRef  = useRef(null)
  const analyserRef  = useRef(null)
  const audioRefs    = useRef(new Map())
  const processorRef = useRef(null)
  const celebDestRef = useRef(null)
  const sampleBufRef = useRef([])
  const transformRef = useRef(false)
  const canvasRef    = useRef(null)
  const rafRef       = useRef(0)
  const previewRef   = useRef(null)
  const iceQueueRef  = useRef(new Map())

  const guestUrl = `${window.location.origin}/guest/${code}`

  const copyLink = () => {
    navigator.clipboard.writeText(guestUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  // Load voices
  useEffect(() => {
    fetch('/api/call/voices/base').then(r => r.json()).then(d => { if (d.voices?.length) setBaseVoices(d.voices) }).catch(() => {})
    fetch('/api/call/voices/celebrity').then(r => r.json()).then(d => { if (d.voices?.length) setCelebVoices(d.voices) }).catch(() => {})
  }, [])

  const encodeWAV = (samples, sr) => {
    const buf = new ArrayBuffer(44 + samples.length * 2)
    const v = new DataView(buf)
    const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
    ws(0,'RIFF'); v.setUint32(4,36+samples.length*2,true); ws(8,'WAVE'); ws(12,'fmt ')
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true)
    v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true)
    ws(36,'data'); v.setUint32(40,samples.length*2,true)
    let off = 44
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1,Math.min(1,samples[i]))
      v.setInt16(off, s < 0 ? s*0x8000 : s*0x7fff, true); off += 2
    }
    return buf
  }

  const initAudio = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true }, video: false })
      streamRef.current = stream
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') await ctx.resume()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyserRef.current = analyser
      const dest = ctx.createMediaStreamDestination(); processedRef.current = dest.stream
      src.connect(analyser).connect(dest)
      return true
    } catch { setStatus('⚠️ Microphone access denied'); return false }
  }, [])

  const stopCelebTransform = useCallback(() => {
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current.onaudioprocess = null; processorRef.current = null }
    celebDestRef.current = null; sampleBufRef.current = []; transformRef.current = false
  }, [])

  const startCelebTransform = useCallback((vid) => {
    if (!audioCtxRef.current || !streamRef.current) return
    const ctx = audioCtxRef.current; const sr = ctx.sampleRate
    const chunkSamples = Math.floor(sr * 2.0)
    const src = ctx.createMediaStreamSource(streamRef.current)
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    const dest = ctx.createMediaStreamDestination(); celebDestRef.current = dest
    src.connect(analyserRef.current); src.connect(proc); proc.connect(ctx.destination)
    sampleBufRef.current = []; let total = 0
    proc.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0)
      sampleBufRef.current.push(new Float32Array(ch)); total += ch.length
      if (total >= chunkSamples && !transformRef.current) {
        transformRef.current = true
        const combined = new Float32Array(total); let off = 0
        for (const c of sampleBufRef.current) { combined.set(c,off); off += c.length }
        sampleBufRef.current = []; total = 0
        fetch('/api/call/voice/transform', {
          method:'POST', headers:{'Content-Type':'audio/wav','x-voice-id':vid}, body: encodeWAV(combined,sr)
        }).then(async r => {
          if (!r.ok) throw new Error('STS failed')
          const decoded = await ctx.decodeAudioData(await r.arrayBuffer())
          const bs = ctx.createBufferSource(); bs.buffer = decoded; bs.connect(dest); bs.start()
        }).catch(()=>{}).finally(()=>{ transformRef.current = false })
      }
    }
    processorRef.current = proc
    const track = dest.stream.getAudioTracks()[0]
    if (track) {
      processedRef.current = dest.stream
      peersRef.current.forEach(pc => { const s = pc.getSenders().find(s => s.track?.kind==='audio'); if (s) s.replaceTrack(track) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (track) peersRef.current.forEach(pc => { const s = pc.getSenders().find(s => s.track?.kind==='audio'); if (s) s.replaceTrack(track) })
      }
    }
    if (socketRef.current) socketRef.current.emit('voice-mode-change', { roomCode: code, mode: vid })
  }, [code, initAudio, startCelebTransform, stopCelebTransform])

  const handlePreview = useCallback(async (vid, e) => {
    e.stopPropagation()
    if (previewRef.current) { previewRef.current.pause(); previewRef.current = null }
    if (previewing === vid) { setPreviewing(null); return }
    setPreviewing(vid)
    try {
      const r = await fetch(`/api/call/voice/preview/${vid}`)
      if (!r.ok) throw new Error('failed')
      const url = URL.createObjectURL(await r.blob())
      const audio = new Audio(url); previewRef.current = audio
      audio.onended = () => { setPreviewing(null); URL.revokeObjectURL(url) }
      audio.onerror = () => { setPreviewing(null); URL.revokeObjectURL(url) }
      await audio.play()
    } catch { setPreviewing(null) }
  }, [previewing])

  // WebRTC setup
  useEffect(() => {
    if (!code) return
    let active = true
    const setup = async () => {
      const ok = await initAudio(); if (!ok || !active) return
      const socket = io({ path: '/api/socket.io' }); socketRef.current = socket
      socket.on('connect',    () => { setIsConnected(true); setStatus('🟢 Connected'); socket.emit('join-room', code) })
      socket.on('disconnect', () => { setIsConnected(false); setStatus('🔴 Disconnected') })

      const createPeer = (targetId) => {
        const pc = new RTCPeerConnection({ iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'turn:openrelay.metered.ca:80',   username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443',  username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ], iceTransportPolicy: 'all' })
        processedRef.current?.getTracks().forEach(t => pc.addTrack(t, processedRef.current))
        pc.onicecandidate = (e) => { if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, targetId }) }
        pc.oniceconnectionstatechange = () => {
          const s = pc.iceConnectionState
          if (s === 'connected' || s === 'completed') setStatus('🟢 Audio connected')
          else if (s === 'failed') setStatus('🔴 Audio failed — refresh')
          else if (s === 'checking') setStatus('🟡 Connecting audio…')
        }
        pc.ontrack = (e) => {
          let el = audioRefs.current.get(targetId)
          if (!el) {
            el = document.createElement('audio')
            el.autoplay = true
            el.setAttribute('playsinline', '')
            document.body.appendChild(el)
            audioRefs.current.set(targetId, el)
          }
          el.srcObject = e.streams[0]; el.play().catch(()=>{})
        }
        peersRef.current.set(targetId, pc); return pc
      }

      const drain = async (pc, targetId) => {
        const q = iceQueueRef.current.get(targetId) ?? []; iceQueueRef.current.delete(targetId)
        for (const c of q) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
      }

      socket.on('room-peers',  (ids) => { setPeersCount(ids.length); ids.forEach(id => createPeer(id)) })
      socket.on('peer-joined', async (targetId) => {
        setPeersCount(n => n+1); const pc = createPeer(targetId)
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
          const q = iceQueueRef.current.get(targetId) ?? []; q.push(candidate); iceQueueRef.current.set(targetId, q); return
        }
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
      })
      socket.on('peer-left', (targetId) => {
        setPeersCount(n => Math.max(0,n-1))
        peersRef.current.get(targetId)?.close(); peersRef.current.delete(targetId)
        const el = audioRefs.current.get(targetId); if (el) { el.srcObject = null; audioRefs.current.delete(targetId) }
      })
    }
    setup()
    return () => {
      active = false; stopCelebTransform()
      socketRef.current?.emit('leave-room', code); socketRef.current?.disconnect()
      peersRef.current.forEach(pc => pc.close()); peersRef.current.clear()
      audioRefs.current.forEach(el => { el.srcObject = null }); audioRefs.current.clear()
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
      cancelAnimationFrame(rafRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // Waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!analyserRef.current) return
      const data = new Uint8Array(analyserRef.current.frequencyBinCount)
      analyserRef.current.getByteFrequencyData(data)
      const barW = canvas.width / data.length * 2.5; let x = 0
      for (let i = 0; i < data.length; i++) {
        const h = (data[i] / 255) * canvas.height
        ctx.fillStyle = `rgba(139,92,246,${0.3 + (data[i]/255)*0.7})`
        ctx.fillRect(x, canvas.height - h, barW - 1, h); x += barW + 1
      }
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [isConnected])

  const toggleMute = () => {
    const next = !isMuted; setIsMuted(next)
    processedRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
  }

  const visibleCelebs = celebVoices.filter(v => v.gender === celebGender)

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div>
          <p className="text-xs text-gray-400 font-mono">Room code</p>
          <p className="text-lg font-bold tracking-widest text-purple-400">{code}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-mono ${isConnected ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-400'}`}>
            {status}
          </span>
          {peersCount > 0 && <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-1 rounded-full font-mono">{peersCount} in room</span>}
        </div>
      </div>

      {/* Guest link */}
      <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-800 flex items-center gap-2">
        <p className="text-xs text-gray-400 truncate flex-1 font-mono">{guestUrl}</p>
        <button onClick={copyLink} className="flex items-center gap-1 text-xs bg-purple-700 hover:bg-purple-600 text-white px-3 py-1 rounded-lg transition-colors">
          {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy Link</>}
        </button>
      </div>

      {/* Waveform */}
      <div className="px-4 pt-3">
        <canvas ref={canvasRef} width={400} height={48} className="w-full rounded-lg bg-gray-900/60" />
      </div>

      {/* Voice selector */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Tab bar */}
        <div className="flex gap-2 mb-3">
          {['base','celebrity'].map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${activeTab===t ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              {t === 'celebrity' ? '⭐ Celebrity' : '🎙️ Base'}
            </button>
          ))}
          {activeTab === 'celebrity' && (
            <div className="flex gap-1 ml-auto">
              {['male','female'].map(g => (
                <button key={g} onClick={() => setCelebGender(g)}
                  className={`px-2 py-1 rounded text-xs capitalize transition-colors ${celebGender===g ? 'bg-purple-800 text-purple-200' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}>
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeTab === 'base' && (
          <div className="grid grid-cols-2 gap-2">
            {baseVoices.map(v => {
              const sel = voiceId === v.voiceId
              return (
                <button key={v.voiceId} onClick={() => handleVoiceChange(v.voiceId)}
                  className={`relative flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${sel ? 'bg-purple-900/40 border-purple-500 text-purple-200' : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-purple-700'}`}>
                  <span className="text-2xl">{v.emoji}</span>
                  <span className="text-xs font-semibold">{v.name}</span>
                  {v.description && <span className="text-[10px] text-gray-500">{v.description}</span>}
                  {sel && v.voiceId !== 'natural' && (
                    <div className="flex items-center gap-1 text-[9px] text-purple-400 font-mono">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" /> AI LIVE
                    </div>
                  )}
                  {v.voiceId !== 'natural' && (
                    <button onClick={(e) => handlePreview(v.voiceId, e)}
                      className="absolute top-2 right-2 p-1 rounded-md bg-gray-800 hover:bg-purple-900 text-gray-400 hover:text-purple-300 transition-colors">
                      {previewing === v.voiceId ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    </button>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {activeTab === 'celebrity' && (
          <div className="grid grid-cols-2 gap-2">
            {visibleCelebs.length === 0 && (
              <div className="col-span-2 text-center py-8 text-gray-500 text-xs">Loading celebrity voices…</div>
            )}
            {visibleCelebs.map(v => {
              const isPending = v.pending
              const sel = !isPending && voiceId === v.voiceId
              return (
                <button key={v.voiceId} disabled={isPending} onClick={() => !isPending && handleVoiceChange(v.voiceId)}
                  className={`relative flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${isPending ? 'opacity-40 cursor-not-allowed bg-gray-900 border-gray-800' : sel ? 'bg-purple-900/40 border-purple-500' : 'bg-gray-900 border-gray-700 hover:border-purple-700'}`}>
                  <span className="text-3xl">{v.emoji}</span>
                  <span className={`text-xs font-semibold ${sel ? 'text-purple-200' : 'text-gray-300'}`}>{v.name}</span>
                  {isPending ? <span className="text-[9px] text-gray-600 font-mono">Unavailable</span>
                    : <div className="flex items-center gap-1 text-[9px] text-gray-500 font-mono"><Sparkles className="w-2.5 h-2.5" /> AI Voice</div>}
                  {!isPending && sel && <div className="absolute top-2 right-2 flex items-center gap-0.5 text-[8px] text-purple-400 font-mono bg-purple-900/60 px-1.5 py-0.5 rounded"><div className="w-1 h-1 rounded-full bg-purple-400 animate-pulse mr-1" />LIVE</div>}
                  {!isPending && !sel && (
                    <button onClick={(e) => handlePreview(v.voiceId, e)}
                      className="absolute top-2 right-2 p-1 rounded-md bg-gray-800 hover:bg-purple-900 text-gray-400 hover:text-purple-300 transition-colors">
                      {previewing === v.voiceId ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    </button>
                  )}
                </button>
              )
            })}
          </div>
        )}
        <p className="text-center text-[9px] text-gray-600 font-mono mt-3">
          {voiceId !== 'natural' ? 'ElevenLabs AI · ~2s processing delay' : 'Natural voice — no processing'}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 px-4 py-4 border-t border-gray-800 bg-gray-900">
        <button onClick={toggleMute}
          className={`w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all ${isMuted ? 'border-red-500 bg-red-900/30 text-red-400' : 'border-gray-600 bg-gray-800 text-gray-200 hover:border-purple-500 hover:text-purple-300'}`}>
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
        <button onClick={onLeave}
          className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white transition-all shadow-[0_0_20px_rgba(220,38,38,0.3)]">
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  )
}
