import { useState, useEffect } from 'react';
import BotConsole from '../components/BotConsole';

export default function WhatsAppPage() {
  
  const [status, setStatus] = useState(null);
  const [stats, setStats] = useState(null);
  const LOCAL_BOT = { id: 'local', name: 'Local Bot', url: '', isLocal: true };

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const connected = status?.connected;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-2xl">💬</span>
        <span className="font-bold">WhatsApp Bot</span>
        <div className={`flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-full border ${connected ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-slate-500 bg-slate-800 border-slate-700'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
          {connected ? 'CONNECTED' : 'OFFLINE'}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Messages Today', value: stats.messagesToday ?? '—' },
              { label: 'Commands Used', value: stats.commandsToday ?? '—' },
              { label: 'AI Replies', value: stats.aiRepliesToday ?? '—' },
              { label: 'Uptime', value: status?.uptime ? `${Math.floor(status.uptime / 3600)}h` : '—' },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">{s.label}</div>
                <div className="text-2xl font-bold text-slate-100">{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* QR / pairing section */}
        {status && !connected && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-5 mb-6 flex items-start gap-4">
            <span className="text-3xl">⚡</span>
            <div>
              <div className="font-semibold text-yellow-400 mb-1">Bot not connected</div>
              <div className="text-sm text-slate-400">Scan the QR code shown in the console below or use the pairing code to connect.</div>
            </div>
          </div>
        )}

        {/* Bot console */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/50" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
            <div className="w-3 h-3 rounded-full bg-green-500/50" />
            <span className="text-xs font-mono text-slate-500 ml-2">whatsapp-bot console</span>
          </div>
          <BotConsole bot={LOCAL_BOT} />
        </div>

        {/* Quick commands */}
        <div className="mt-6 bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Quick Reference</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs font-mono">
            {[
              ['.song <name>', 'Download full MP3'],
              ['.pay', 'Ghost Bank account'],
              ['.ai on/off', 'Toggle AI replies'],
              ['.persona', 'Manage personas'],
              ['.fake call', 'Fake incoming call'],
              ['.menu', 'Full command list'],
            ].map(([cmd, desc]) => (
              <div key={cmd} className="flex flex-col gap-0.5 bg-slate-950 rounded-lg p-2 border border-slate-800">
                <span className="text-green-400">{cmd}</span>
                <span className="text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
