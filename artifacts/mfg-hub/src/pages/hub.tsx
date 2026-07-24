import React from 'react';
import { Link } from 'wouter';
import { Zap, MessageCircle, Send, PhoneCall, Mic } from 'lucide-react';
import { useGetTelegramStatus } from '@workspace/api-client-react';
import { useGetSignalStatus } from '@workspace/api-client-react';
import { useWhatsAppStatus, useWhatsAppUrl } from '@/hooks/use-whatsapp';

export default function HubHome() {
  const { url: waUrl } = useWhatsAppUrl();
  const { data: waStatus } = useWhatsAppStatus(waUrl);
  const { data: tgStatus } = useGetTelegramStatus({ query: { refetchInterval: 5000 } });
  const { data: sigStatus } = useGetSignalStatus({ query: { refetchInterval: 5000 } });

  return (
    <div className="min-h-screen p-8 md:p-12 max-w-6xl mx-auto space-y-12">
      <header className="flex items-center gap-4 border-b border-border/50 pb-8">
        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/30 shadow-[0_0_20px_rgba(0,255,255,0.2)]">
          <Zap className="text-primary w-6 h-6 animate-pulse" />
        </div>
        <div>
          <h1 className="text-4xl font-bold font-mono tracking-tight text-white glitch-text">MFG BOT HUB</h1>
          <p className="text-muted-foreground font-mono text-sm mt-1 uppercase tracking-widest">Operations Control Panel // System Online</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* WhatsApp Card */}
        <div className="rounded-xl border border-white/10 bg-card p-6 glow-green relative overflow-hidden group flex flex-col">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00ff80] to-transparent opacity-50" />
          
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-[#00ff80]/10 rounded-lg text-[#00ff80]">
                <MessageCircle size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white font-mono">WHATSAPP</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="relative flex h-2.5 w-2.5">
                    {waStatus?.connected ? (
                      <>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ff80] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00ff80]"></span>
                      </>
                    ) : waStatus?.hasQr ? (
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500"></span>
                    ) : (
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    )}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground uppercase">
                    {waStatus?.connected ? 'ONLINE' : waStatus?.hasQr ? 'QR READY' : 'OFFLINE'}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex-1 text-sm text-muted-foreground mb-8">
            <p>Status: {waStatus?.connected ? `Connected. Uptime: ${waStatus.uptime}s` : 'Awaiting connection.'}</p>
            {waStatus?.connected && <p>Messages: {waStatus.messageCount} | AI: {waStatus.aiEnabled ? 'ON' : 'OFF'}</p>}
          </div>

          <Link href="/whatsapp" className="w-full py-3 px-4 bg-[#00ff80]/10 hover:bg-[#00ff80]/20 text-[#00ff80] border border-[#00ff80]/30 rounded-md font-mono text-center transition-colors shadow-[0_0_15px_rgba(0,255,128,0.1)] block">
            LAUNCH CONSOLE
          </Link>
        </div>

        {/* Telegram Card */}
        <div className="rounded-xl border border-white/10 bg-card p-6 glow-panel relative overflow-hidden group flex flex-col">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00ccff] to-transparent opacity-50" />
          
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-[#00ccff]/10 rounded-lg text-[#00ccff]">
                <Send size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white font-mono">TELEGRAM</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="relative flex h-2.5 w-2.5">
                    {tgStatus?.connected ? (
                      <>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ccff] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00ccff]"></span>
                      </>
                    ) : (
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    )}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground uppercase">
                    {tgStatus?.connected ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex-1 text-sm text-muted-foreground mb-8">
            <p>Status: {tgStatus?.connected ? `Connected as ${tgStatus.username || tgStatus.phone}` : 'Awaiting credentials.'}</p>
          </div>

          <Link href="/telegram" className="w-full py-3 px-4 bg-[#00ccff]/10 hover:bg-[#00ccff]/20 text-[#00ccff] border border-[#00ccff]/30 rounded-md font-mono text-center transition-colors shadow-[0_0_15px_rgba(0,204,255,0.1)] block">
            LAUNCH CONSOLE
          </Link>
        </div>

        {/* Signal Card */}
        <div className="rounded-xl border border-white/10 bg-card p-6 glow-purple relative overflow-hidden group flex flex-col">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#a855f7] to-transparent opacity-50" />
          
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-[#a855f7]/10 rounded-lg text-[#a855f7]">
                <MessageCircle size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white font-mono">SIGNAL</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="relative flex h-2.5 w-2.5">
                    {sigStatus?.ready ? (
                      <>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#a855f7] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#a855f7]"></span>
                      </>
                    ) : sigStatus?.phase && sigStatus.phase !== 'idle' ? (
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500"></span>
                    ) : (
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    )}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground uppercase">
                    {sigStatus?.ready ? 'ONLINE' : sigStatus?.phase || 'OFFLINE'}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex-1 text-sm text-muted-foreground mb-8">
            <p>Phase: {sigStatus?.phase || 'Unknown'}</p>
            {sigStatus?.number && <p>Number: {sigStatus.number}</p>}
          </div>

          <Link href="/signal" className="w-full py-3 px-4 bg-[#a855f7]/10 hover:bg-[#a855f7]/20 text-[#a855f7] border border-[#a855f7]/30 rounded-md font-mono text-center transition-colors shadow-[0_0_15px_rgba(168,85,247,0.1)] block">
            LAUNCH CONSOLE
          </Link>
        </div>

        {/* Voice Changer Card */}
        <div className="rounded-xl border border-white/10 bg-card p-6 glow-panel relative overflow-hidden group flex flex-col">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#ec4899] to-transparent opacity-50" />
          
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-[#ec4899]/10 rounded-lg text-[#ec4899]">
                <Mic size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white font-mono">VOICE CHANGER</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-mono text-muted-foreground uppercase">
                    TOOL
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex-1 text-sm text-muted-foreground mb-8">
            <p>Real-time audio processing.</p>
            <p>Tone.js pitch shifting and formants.</p>
          </div>

          <Link href="/voice-changer" className="w-full py-3 px-4 bg-[#ec4899]/10 hover:bg-[#ec4899]/20 text-[#ec4899] border border-[#ec4899]/30 rounded-md font-mono text-center transition-colors shadow-[0_0_15px_rgba(236,72,153,0.1)] block">
            OPEN TOOL
          </Link>
        </div>
      </div>
    </div>
  );
}
