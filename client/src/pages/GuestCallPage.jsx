import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Mic, MicOff, PhoneOff, Heart } from 'lucide-react'

const HEARTS = ['💕','💗','💖','💓','💝','💘','🩷','❤️','💞','💌','🫀','💟']
const floaters = Array.from({ length: 12 }, (_, i) => ({
  id: i, emoji: HEARTS[i % HEARTS.length],
  left: `${Math.random()*90+5}%`, size: `${Math.random()*1+1.2}rem`,
  dur: Math.random()*8+8, delay: Math.random()*6
}))

export default function GuestCallPage() {
  const code = window.location.pathname.split('/').pop()
  const [room, setRoom]           = useState(null)
  const [notFound, setNotFound]   = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted]     = useState(false)
  const [peersCount, setPeersCount] = useState(0)
  const [hasLeft, setHasLeft]     = useState(false)

  const socketRef  = useRef(null)
  const peersRef   = useRef(new Map())
  const streamRef  = useRef(null)
  const audioRefs  = useRef(new Map())
  const iceQueueRef = useRef(new Map())

  useEffect(() => {
    fetch(`/api/call/rooms/${code}`)
      .then(r => { if (r.status === 404) { setNotFound(true); return null } return r.json() })
      .then(d => { if (d) setRoom(d) })
      .catch(() => setNotFound(true))
  }, [code])

  const initAudio = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true }, video: false })
      streamRef.current = s; return true
    } catch { return false }
  }, [])

  useEffect(() => {
    if (!room) return
    let active = true
    const setup = async () => {
      const ok = await initAudio(); if (!ok || !active) return
      const socket = io({ path: '/api/socket.io' }); socketRef.current = socket
      socket.on('connect', () => { setIsConnected(true); socket.emit('join-room', code) })
      socket.on('disconnect', () => setIsConnected(false))

      const createPeer = (targetId) => {
        const pc = new RTCPeerConnection({ iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }
        ]})
        streamRef.current?.getTracks().forEach(t => pc.addTrack(t, streamRef.current))
        pc.onicecandidate = (e) => { if (e.candidate) socket.emit('ice-candidate', { candidate: e.candidate, targetId }) }
        pc.ontrack = (e) => {
          let el = audioRefs.current.get(targetId)
          if (!el) { el = new Audio(); el.autoplay = true; audioRefs.current.set(targetId, el) }
          el.srcObject = e.streams[0]; el.play().catch(()=>{})
        }
        peersRef.current.set(targetId, pc); return pc
      }
      const drain = async (pc, targetId) => {
        const q = iceQueueRef.current.get(targetId) ?? []; iceQueueRef.current.delete(targetId)
        for (const c of q) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
      }

      socket.on('room-peers',  ids => { setPeersCount(ids.length); ids.forEach(id => createPeer(id)) })
      socket.on('peer-joined', async targetId => {
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
      socket.on('peer-left', targetId => {
        setPeersCount(n => Math.max(0,n-1))
        peersRef.current.get(targetId)?.close(); peersRef.current.delete(targetId)
        const el = audioRefs.current.get(targetId); if (el) { el.srcObject = null; audioRefs.current.delete(targetId) }
      })
    }
    setup()
    return () => {
      active = false
      socketRef.current?.emit('leave-room', code); socketRef.current?.disconnect()
      peersRef.current.forEach(pc => pc.close()); peersRef.current.clear()
      audioRefs.current.forEach(el => { el.srcObject = null }); audioRefs.current.clear()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])

  const toggleMute = () => {
    const next = !isMuted; setIsMuted(next)
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next })
  }
  const leaveCall = () => {
    socketRef.current?.emit('leave-room', code); socketRef.current?.disconnect()
    streamRef.current?.getTracks().forEach(t => t.stop())
    setHasLeft(true)
  }

  if (notFound) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-center px-6">
      <div>
        <div className="text-5xl mb-4">❌</div>
        <h1 className="text-xl font-bold text-white mb-2">Room not found</h1>
        <p className="text-gray-400 text-sm">This call room doesn&apos;t exist or has ended.</p>
      </div>
    </div>
  )

  if (!room) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400 text-sm animate-pulse">Joining call…</div>
    </div>
  )

  if (hasLeft) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-center px-6">
      <div>
        <div className="text-5xl mb-4">📵</div>
        <h1 className="text-xl font-bold text-white mb-2">Call ended</h1>
        <p className="text-gray-400 text-sm">You left the room.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-between py-12 px-6 relative overflow-hidden">
      {/* Floating hearts */}
      {floaters.map(h => (
        <div key={h.id} className="absolute pointer-events-none select-none"
          style={{ left: h.left, bottom: '-2rem', fontSize: h.size, animation: `floatUp ${h.dur}s ${h.delay}s infinite linear` }}>
          {h.emoji}
        </div>
      ))}

      <div className="text-center z-10">
        <div className="text-6xl mb-3 animate-pulse"><Heart className="w-16 h-16 text-pink-500 mx-auto" /></div>
        <h1 className="text-2xl font-bold text-white mb-1">Private Call</h1>
        <p className="text-gray-400 text-sm font-mono tracking-widest">{code}</p>
      </div>

      <div className="z-10 text-center">
        <div className={`w-32 h-32 rounded-full border-4 flex items-center justify-center mx-auto mb-6 ${isConnected ? 'border-green-500 bg-green-900/20' : 'border-gray-700 bg-gray-900'}`}>
          {isConnected
            ? <div className="text-center"><div className="w-3 h-3 rounded-full bg-green-400 animate-pulse mx-auto mb-1" /><p className="text-green-400 text-xs font-mono">LIVE</p></div>
            : <p className="text-gray-500 text-xs font-mono">Connecting…</p>}
        </div>
        {peersCount > 0 && <p className="text-gray-400 text-sm mb-4">{peersCount} other{peersCount !== 1 ? 's' : ''} in call</p>}
        <p className="text-gray-500 text-xs font-mono">End-to-end encrypted · WebRTC</p>
      </div>

      <div className="z-10 flex items-center gap-6">
        <button onClick={toggleMute}
          className={`w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all ${isMuted ? 'border-red-500 bg-red-900/30 text-red-400' : 'border-gray-600 bg-gray-800 text-gray-200 hover:border-pink-500 hover:text-pink-300'}`}>
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
        <button onClick={leaveCall}
          className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white transition-all">
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>

      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0) rotate(0deg);   opacity: 0.8 }
          100% { transform: translateY(-110vh) rotate(20deg); opacity: 0 }
        }
      `}</style>
    </div>
  )
}
