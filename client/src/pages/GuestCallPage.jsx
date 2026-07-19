import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Mic, MicOff, PhoneOff, Lock } from 'lucide-react'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80',   username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

export default function GuestCallPage() {
  const code = window.location.pathname.split('/').pop()

  const [room, setRoom]             = useState(null)
  const [notFound, setNotFound]     = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted]       = useState(false)
  const [peersCount, setPeersCount] = useState(0)
  const [hasLeft, setHasLeft]       = useState(false)
  const [iceState, setIceState]     = useState('new')
  const [timer, setTimer]           = useState(0)

  const socketRef   = useRef(null)
  const peersRef    = useRef(new Map())
  const streamRef   = useRef(null)
  const audioRefs   = useRef(new Map())
  const iceQueueRef = useRef(new Map())
  const timerRef    = useRef(null)

  const isLive   = iceState === 'connected' || iceState === 'completed'
  const isFailed = iceState === 'failed'

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

  const initAudio = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, video: false
      })
      streamRef.current = s
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      if (ctx.state === 'suspended') await ctx.resume()
      ctx.close()
      return true
    } catch { return false }
  }, [])

  useEffect(() => {
    if (!room) return
    let active = true
    const setup = async () => {
      const ok = await initAudio(); if (!ok || !active) return
      const socket = io({ path: '/api/socket.io' }); socketRef.current = socket
      socket.on('connect',    () => { setIsConnected(true); socket.emit('join-room', code) })
      socket.on('disconnect', () => setIsConnected(false))

      const createPeer = (targetId) => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceTransportPolicy: 'all' })
        streamRef.current?.getTracks().forEach(t => pc.addTrack(t, streamRef.current))
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

      socket.on('room-peers', ids => { setPeersCount(ids.length); ids.forEach(id => createPeer(id)) })
      socket.on('peer-joined', async targetId => {
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
      socket.on('peer-left', targetId => {
        setPeersCount(n => Math.max(0, n - 1))
        peersRef.current.get(targetId)?.close(); peersRef.current.delete(targetId)
        const el = audioRefs.current.get(targetId)
        if (el) { el.srcObject = null; el.remove(); audioRefs.current.delete(targetId) }
      })
    }
    setup()
    return () => {
      active = false
      clearInterval(timerRef.current)
      socketRef.current?.emit('leave-room', code); socketRef.current?.disconnect()
      peersRef.current.forEach(pc => pc.close()); peersRef.current.clear()
      audioRefs.current.forEach(el => { el.srcObject = null; el.remove() }); audioRefs.current.clear()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [room])

  const toggleMute = () => {
    const next = !isMuted; setIsMuted(next)
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
  }

  const leaveCall = () => {
    socketRef.current?.emit('leave-room', code); socketRef.current?.disconnect()
    streamRef.current?.getTracks().forEach(t => t.stop()); setHasLeft(true)
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
        @keyframes ring-a {
          0%,100% { transform:scale(1);    opacity:0.45; }
          50%      { transform:scale(1.07); opacity:0.12; }
        }
        @keyframes ring-b {
          0%,100% { transform:scale(1);    opacity:0.25; }
          50%      { transform:scale(1.13); opacity:0.06; }
        }
        @keyframes ring-c {
          0%,100% { transform:scale(1);    opacity:0.12; }
          50%      { transform:scale(1.20); opacity:0.02; }
        }
      `}</style>

      {/* Header */}
      <div className="text-center">
        <div className="flex items-center gap-1.5 justify-center mb-2">
          <Lock className="w-3 h-3 text-gray-600" />
          <span className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">
            End-to-end encrypted
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Private Call</h1>
      </div>

      {/* Avatar + Status */}
      <div className="flex flex-col items-center gap-6">
        <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>

          {/* Outer glow */}
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            boxShadow: isLive
              ? '0 0 70px 25px rgba(139,92,246,0.18)'
              : isFailed
              ? '0 0 50px 15px rgba(239,68,68,0.12)'
              : '0 0 50px 10px rgba(80,70,120,0.1)',
            transition: 'box-shadow 0.5s ease'
          }} />

          {/* Rings */}
          <div className="absolute rounded-full pointer-events-none" style={{
            width: 170, height: 170,
            border: `1.5px solid rgba(139,92,246,${isLive ? 0.35 : isFailed ? 0 : 0.08})`,
            animation: 'ring-a 2.2s ease-in-out infinite'
          }} />
          <div className="absolute rounded-full pointer-events-none" style={{
            width: 192, height: 192,
            border: `1px solid rgba(139,92,246,${isLive ? 0.2 : isFailed ? 0 : 0.04})`,
            animation: 'ring-b 2.2s ease-in-out 0.75s infinite'
          }} />
          <div className="absolute rounded-full pointer-events-none" style={{
            width: 212, height: 212,
            border: `1px solid rgba(139,92,246,${isLive ? 0.1 : 0})`,
            animation: 'ring-c 2.2s ease-in-out 1.5s infinite'
          }} />

          {/* Avatar circle */}
          <div className="relative w-40 h-40 rounded-full flex items-center justify-center" style={{
            background: 'linear-gradient(145deg,#1a1230,#271848)',
            border: `1.5px solid rgba(${isLive ? '139,92,246' : isFailed ? '239,68,68' : '90,70,130'},0.4)`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
            transition: 'border-color 0.5s ease'
          }}>
            <span className="text-6xl select-none">🎭</span>
          </div>
        </div>

        {/* Status text */}
        <div className="text-center min-h-[52px] flex flex-col items-center justify-center gap-1">
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
              <p className="text-gray-700 text-xs">Please refresh and try again</p>
            </>
          ) : isConnected ? (
            <>
              <p className="text-yellow-400 text-sm font-medium animate-pulse">Connecting audio…</p>
              <p className="text-gray-700 text-xs">This takes a few seconds</p>
            </>
          ) : (
            <p className="text-gray-600 text-sm animate-pulse">Joining call…</p>
          )}
        </div>

        {/* Status pill */}
        <div className="flex items-center gap-1.5 rounded-full px-4 py-1.5" style={{
          background: isLive ? 'rgba(34,197,94,0.08)' : isFailed ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.06)',
          border: `1px solid rgba(${isLive ? '34,197,94' : isFailed ? '239,68,68' : '99,102,241'},0.2)`
        }}>
          <div className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : isFailed ? 'bg-red-400' : 'bg-indigo-400 animate-pulse'}`} />
          <span className={`text-[11px] font-mono font-semibold ${isLive ? 'text-green-400' : isFailed ? 'text-red-400' : 'text-indigo-400'}`}>
            {isLive ? 'CONNECTED' : isFailed ? 'FAILED' : 'CONNECTING'}
          </span>
          {peersCount > 0 && !isFailed && (
            <span className="text-gray-700 text-[11px] font-mono ml-1">· {peersCount} in room</span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-8">
        <button onClick={toggleMute}
          className="w-14 h-14 rounded-full flex items-center justify-center transition-all"
          style={isMuted
            ? { background: 'rgba(239,68,68,0.15)', border: '1.5px solid rgba(239,68,68,0.4)' }
            : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {isMuted ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5 text-gray-300" />}
        </button>
        <button onClick={leaveCall}
          className="w-16 h-16 rounded-full flex items-center justify-center text-white transition-all"
          style={{ background: '#dc2626', boxShadow: '0 8px 32px rgba(220,38,38,0.4)' }}>
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  )
}
