import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Mic, MicOff, Square, Play, Volume2 } from 'lucide-react';

export default function VoiceChangerPage() {
  const [status, setStatus] = useState<'idle'|'loading'|'running'|'error'>('idle');
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [preset, setPreset] = useState(0);
  const [err, setErr] = useState('');
  
  const shiftRef = useRef<any>(null);
  const gainRef = useRef<any>(null);
  const animRef = useRef<number>(0);
  const sessionRef = useRef<any>(null);

  const VOICE_PRESETS = [
    { name: 'Natural',    pitch: 0,    emoji: '🎙️', color: '#64748b',  desc: 'Your real voice' },
    { name: 'Girl',       pitch: 5,    emoji: '🌸', color: '#ec4899',   desc: 'Female, natural' },
    { name: 'Young Girl', pitch: 9,    emoji: '✨', color: '#a855f7', desc: 'Higher, younger' },
    { name: 'Deep Man',   pitch: -4,   emoji: '🎭', color: '#3b82f6',   desc: 'Low, serious tone' },
    { name: 'Old Man',    pitch: -6,   emoji: '👴', color: '#f59e0b',  desc: 'Older, gruff voice' },
    { name: 'Alien',      pitch: 7,    emoji: '👽', color: '#10b981',  desc: 'Eerie, unearthly' },
  ];

  useEffect(() => {
    return () => { stop(); };
  }, []);

  const changePreset = (idx: number) => {
    setPreset(idx);
    if (shiftRef.current) shiftRef.current.pitch = VOICE_PRESETS[idx].pitch;
  };

  const start = async () => {
    setStatus('loading'); 
    setErr('');
    try {
      const Tone = await import('tone');
      const ctx = Tone.getContext();
      if (ctx.state !== 'running') {
        await Tone.start();
        let waited = 0;
        while (ctx.state !== 'running' && waited < 3000) {
          await new Promise(r => setTimeout(r, 100)); waited += 100;
        }
        if (ctx.state !== 'running') throw new Error('AudioContext could not start — try Chrome or Edge');
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const rawCtx = ctx.rawContext as AudioContext;
      const src = rawCtx.createMediaStreamSource(stream);
      const analyser = rawCtx.createAnalyser(); analyser.fftSize = 512;
      const gainNode = rawCtx.createGain(); gainNode.gain.value = 1;
      gainRef.current = gainNode;
      const p = VOICE_PRESETS[preset];
      const shift = new Tone.PitchShift({ pitch: p.pitch, windowSize: 0.25, delayTime: 0, feedback: 0, wet: p.pitch === 0 ? 0 : 1 });
      shiftRef.current = shift;
      const hpFilter = rawCtx.createBiquadFilter(); hpFilter.type = 'highpass'; hpFilter.frequency.value = 80;
      const comp = rawCtx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.15;
      src.connect(analyser); src.connect(gainNode);
      Tone.connect(gainNode, shift); shift.connect(hpFilter); hpFilter.connect(comp); comp.connect(rawCtx.destination);
      sessionRef.current = { stream, Tone };
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => { 
        animRef.current = requestAnimationFrame(tick); 
        analyser.getByteFrequencyData(data); 
        setVolume(data.reduce((a,b)=>a+b,0)/data.length/128); 
      };
      tick();
      setStatus('running');
    } catch(e: any) {
      setErr(e.message || 'Could not start'); 
      setStatus('error');
    }
  };

  const stop = () => {
    cancelAnimationFrame(animRef.current);
    sessionRef.current?.stream?.getTracks().forEach((t:any) => t.stop());
    try { shiftRef.current?.disconnect(); } catch {}
    shiftRef.current = null; gainRef.current = null; sessionRef.current = null;
    setStatus('idle'); setVolume(0); setMuted(false); setErr('');
  };

  const toggleMute = () => {
    setMuted(prev => {
      const next = !prev;
      if (gainRef.current) gainRef.current.gain.linearRampToValueAtTime(next ? 0 : 1, gainRef.current.context.currentTime + 0.05);
      return next;
    });
  };

  const currentPresetColor = VOICE_PRESETS[preset].color;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-[#ec4899]/20 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-muted-foreground hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div className="h-8 w-8 rounded bg-[#ec4899]/10 flex items-center justify-center border border-[#ec4899]/30 text-[#ec4899]">
              <Mic size={18} />
            </div>
            <h1 className="text-xl font-bold font-mono tracking-tight text-white">REAL-TIME <span className="text-[#ec4899]">VOICE CHANGER</span></h1>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 py-8 flex flex-col lg:flex-row gap-8">
        
        {/* Left Column: Controls */}
        <div className="flex-1 space-y-6">
          <div className="bg-card border border-border rounded-xl p-6 glow-panel shadow-[0_0_15px_rgba(236,72,153,0.05)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1" style={{ background: `linear-gradient(to right, transparent, ${currentPresetColor}, transparent)` }} />
            
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2">
                <Volume2 size={18} /> AUDIO ENGINE
              </h2>
              <div className="font-mono text-xs px-3 py-1 rounded-full border" style={{ borderColor: `${currentPresetColor}40`, color: currentPresetColor, backgroundColor: `${currentPresetColor}10` }}>
                {status.toUpperCase()}
              </div>
            </div>

            <div className="flex justify-center mb-10">
              {status === 'running' ? (
                <div className="flex gap-4">
                  <button onClick={stop} className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 text-red-500 flex flex-col items-center justify-center hover:bg-red-500/20 transition-all shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                    <Square size={24} className="mb-1" />
                    <span className="text-xs font-mono font-bold">STOP</span>
                  </button>
                  <button onClick={toggleMute} className={`w-20 h-20 rounded-full border flex flex-col items-center justify-center transition-all ${muted ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.2)]' : 'bg-white/5 border-white/10 text-white hover:bg-white/10'}`}>
                    {muted ? <MicOff size={24} className="mb-1" /> : <Mic size={24} className="mb-1" />}
                    <span className="text-xs font-mono font-bold">{muted ? 'UNMUTE' : 'MUTE'}</span>
                  </button>
                </div>
              ) : status === 'loading' ? (
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/20 text-white flex flex-col items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin mb-1" />
                  <span className="text-xs font-mono">INIT</span>
                </div>
              ) : (
                <button onClick={start} className="w-20 h-20 rounded-full bg-[#ec4899]/10 border border-[#ec4899]/30 text-[#ec4899] flex flex-col items-center justify-center hover:bg-[#ec4899]/20 transition-all shadow-[0_0_20px_rgba(236,72,153,0.2)]">
                  <Play size={24} className="mb-1 ml-1" />
                  <span className="text-xs font-mono font-bold">START</span>
                </button>
              )}
            </div>

            {/* VU Meter */}
            <div className="bg-black/50 h-6 rounded-md border border-white/5 overflow-hidden relative">
              <div 
                className="h-full transition-all duration-75"
                style={{ 
                  width: `${Math.min(volume * 100, 100)}%`, 
                  background: `linear-gradient(90deg, ${currentPresetColor}40, ${currentPresetColor})`,
                  opacity: status === 'running' && !muted ? 1 : 0.2
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white/50 mix-blend-difference">
                MIC INPUT LEVEL
              </div>
            </div>

            {err && (
              <div className="mt-6 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 font-mono text-sm text-center">
                {err}
              </div>
            )}
          </div>

          {/* Guide section */}
          <div className="bg-card border border-border rounded-xl p-6 glow-panel">
            <h2 className="text-lg font-mono font-bold text-white mb-4">PLATFORM ROUTING</h2>
            <div className="space-y-4">
              <details className="group bg-black/40 border border-white/5 rounded-lg">
                <summary className="p-4 cursor-pointer font-mono text-sm text-[#ec4899] font-bold">PC / Desktop Audio Routing</summary>
                <div className="px-4 pb-4 font-sans text-sm text-muted-foreground space-y-2">
                  <p>1. Install a Virtual Audio Cable (e.g., VB-Audio Cable).</p>
                  <p>2. Set your browser's audio output to "CABLE Input".</p>
                  <p>3. In your chat app (Discord, WhatsApp Web), set microphone to "CABLE Output".</p>
                </div>
              </details>
              <details className="group bg-black/40 border border-white/5 rounded-lg">
                <summary className="p-4 cursor-pointer font-mono text-sm text-blue-400 font-bold">Telegram / Mobile Setup</summary>
                <div className="px-4 pb-4 font-sans text-sm text-muted-foreground space-y-2">
                  <p>1. Play the processed audio out of your computer speakers.</p>
                  <p>2. Hold your phone's microphone near the speakers while recording voice notes.</p>
                  <p>Alternative: Use Android's internal audio routing apps (requires root) or a physical loopback cable.</p>
                </div>
              </details>
            </div>
          </div>
        </div>

        {/* Right Column: Presets */}
        <div className="flex-[1.5]">
          <h2 className="text-lg font-mono font-bold text-white mb-6">VOICE PRESETS</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {VOICE_PRESETS.map((p, idx) => (
              <button
                key={p.name}
                onClick={() => changePreset(idx)}
                className={`p-5 rounded-xl border text-left transition-all ${
                  preset === idx 
                    ? 'bg-white/10 shadow-lg scale-[1.02] z-10 relative' 
                    : 'bg-black/40 border-white/5 hover:border-white/20 hover:bg-white/5'
                }`}
                style={{ 
                  borderColor: preset === idx ? p.color : undefined,
                  boxShadow: preset === idx ? `0 0 20px ${p.color}20` : undefined
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{p.emoji}</span>
                  <div className="text-xs font-mono font-bold opacity-50">SHIFT {p.pitch > 0 ? `+${p.pitch}` : p.pitch}</div>
                </div>
                <h3 className="text-lg font-bold font-mono text-white mb-1">{p.name}</h3>
                <p className="text-sm text-muted-foreground">{p.desc}</p>
              </button>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
