import { useState, useEffect } from 'react';

export default function TelegramPage() {
  
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testChat, setTestChat] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  async function poll() {
    try {
      const r = await fetch('/api/telegram/status');
      const d = await r.json();
      setStatus(d);
    } catch {}
  }

  async function saveToken() {
    if (!token.trim()) return;
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/telegram/set-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Failed to save token');
      setMsg('✅ Token saved — bot starting...');
      setToken('');
      setTimeout(poll, 3000);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function sendTest() {
    if (!testChat.trim() || !testMsg.trim()) return;
    setSending(true); setError('');
    try {
      const r = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: testChat.trim(), text: testMsg.trim() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Send failed');
      setMsg('✅ Test message sent!');
      setTestMsg('');
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  const isRunning = status?.running;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-2xl">✈️</span>
        <span className="font-bold">Telegram Bot</span>
        <div className={`flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-full border ${isRunning ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-slate-500 bg-slate-800 border-slate-700'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
          {isRunning ? 'RUNNING' : 'STOPPED'}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Status */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { label: 'Status', value: isRunning ? '✅ Running' : '❌ Stopped' },
            { label: 'Bot Username', value: status?.username || 'Not set' },
            { label: 'Messages Today', value: status?.messagesToday ?? '—' },
            { label: 'Token Set', value: status?.hasToken ? '✅ Yes' : '❌ No' },
          ].map(s => (
            <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">{s.label}</div>
              <div className="text-sm font-mono text-slate-100">{String(s.value)}</div>
            </div>
          ))}
        </div>

        {/* Running banner */}
        {isRunning && status?.username && (
          <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-5 mb-6">
            <div className="text-sky-400 font-semibold mb-1">✈️ Bot Active — @{status.username}</div>
            <div className="text-sm text-slate-400">
              Message your bot on Telegram to start chatting. The bot uses the same AI persona system as the WhatsApp bot.
            </div>
            <a href={`https://t.me/${status.username}`} target="_blank" rel="noreferrer" className="inline-block mt-3 text-xs text-sky-400 hover:underline font-mono">
              Open t.me/{status.username} →
            </a>
          </div>
        )}

        {/* Token setup */}
        {!status?.hasToken && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4">
            <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Setup Bot Token</div>
            <ol className="text-sm text-slate-400 space-y-1 mb-4 list-decimal list-inside">
              <li>Open Telegram and search for <span className="text-sky-400 font-mono">@BotFather</span></li>
              <li>Send <span className="font-mono text-slate-300">/newbot</span> and follow the prompts</li>
              <li>Copy the HTTP API token and paste it below</li>
            </ol>
            <div className="flex gap-2">
              <input
                value={token}
                onChange={e => setToken(e.target.value)}
                type="password"
                placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-300 focus:outline-none focus:border-sky-500/50"
              />
              <button onClick={saveToken} disabled={loading || !token.trim()} className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Test message */}
        {isRunning && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4">
            <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Send Test Message</div>
            <div className="space-y-2">
              <input value={testChat} onChange={e => setTestChat(e.target.value)} placeholder="Chat ID or @username" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-300 focus:outline-none focus:border-sky-500/50" />
              <div className="flex gap-2">
                <input value={testMsg} onChange={e => setTestMsg(e.target.value)} placeholder="Test message..." className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-sky-500/50" />
                <button onClick={sendTest} disabled={sending || !testChat || !testMsg} className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm">
                  {sending ? '...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quick commands */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Supported Commands</div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            {[
              ['/start', 'Introduction message'],
              ['/help', 'Full command list'],
              ['.song <name>', 'Download MP3'],
              ['.ai on/off', 'Toggle AI replies'],
              ['.pay', 'Ghost Bank'],
              ['.weather <city>', 'Weather info'],
            ].map(([cmd, desc]) => (
              <div key={cmd} className="flex flex-col gap-0.5 bg-slate-950 rounded-lg p-2 border border-slate-800">
                <span className="text-sky-400">{cmd}</span>
                <span className="text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mt-4 text-sm font-mono">{error}</div>}
        {msg && <div className="text-green-400 text-sm font-mono mt-4">{msg}</div>}
      </div>
    </div>
  );
}
