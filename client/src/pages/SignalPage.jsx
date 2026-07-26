import { useState, useEffect, useRef } from 'react';

export default function SignalPage() {
  
  const [status, setStatus] = useState(null);
  const [linkState, setLinkState] = useState(null);
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [step, setStep] = useState('idle'); // idle | register | verify | link | linking | linked | running
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, []);

  async function poll() {
    try {
      const r = await fetch('/api/signal/status');
      const d = await r.json();
      setStatus(d);
      if (d.running) setStep('running');
    } catch {}
    try {
      const r = await fetch('/api/signal/link-status');
      const d = await r.json();
      setLinkState(d);
    } catch {}
  }

  async function doRegister() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/signal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, captcha: captcha || undefined }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Registration failed');
      setMsg(d.message || 'SMS sent. Enter the verification code.');
      setStep('verify');
    } catch (e) {
      if (e.message.includes('CAPTCHA')) {
        setError('Signal requires a captcha. Click the captcha link below first.');
      } else {
        setError(e.message);
      }
    } finally { setLoading(false); }
  }

  async function doVerify() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/signal/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, code }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Verification failed');
      setMsg('✅ Verified! Bot is starting...');
      setStep('running');
      setTimeout(poll, 3000);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function doLink() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/signal/link-device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Link failed');
      setStep('linking');
      setMsg('Scan the QR URI in your Signal app → Settings → Linked Devices → Link a Device');
      // Start polling link status
      pollRef.current = setInterval(async () => {
        const ls = await fetch('/api/signal/link-status').then(r => r.json()).catch(() => null);
        if (ls?.state === 'linked') {
          clearInterval(pollRef.current);
          setStep('linked');
          setMsg(`✅ Linked as ${ls.number || 'unknown'}. Bot starting...`);
          setTimeout(poll, 5000);
        }
      }, 2000);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function restartBot() {
    fetch('/api/signal/link-device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restart: true }) }).catch(() => {});
    setMsg('Restarting bot...');
    setTimeout(poll, 3000);
  }

  const manager = status?.manager || {};
  const isRunning = status?.running;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-2xl">🔒</span>
        <span className="font-bold">Signal Bot</span>
        <div className={`flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-full border ${isRunning ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-slate-500 bg-slate-800 border-slate-700'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
          {isRunning ? 'RUNNING' : 'STOPPED'}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Status grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { label: 'Status', value: isRunning ? '✅ Running' : '❌ Stopped' },
            { label: 'Restarts', value: status?.restarts ?? 0 },
            { label: 'Signal CLI', value: manager.phase || 'idle' },
            { label: 'Number', value: status?.number || 'Not set' },
          ].map(s => (
            <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">{s.label}</div>
              <div className="text-sm font-mono text-slate-100">{String(s.value)}</div>
            </div>
          ))}
        </div>

        {/* Error display */}
        {status?.error && !isRunning && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 mb-6 text-xs font-mono text-red-400">{status.error}</div>
        )}

        {/* Running state */}
        {isRunning && (
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5 mb-6">
            <div className="text-green-400 font-semibold mb-2">🔒 Signal Bot Active</div>
            <div className="text-sm text-slate-400 mb-3">
              The Signal bot is running. It will auto-reply to messages on {status?.number || 'your linked number'}.
            </div>
            <button onClick={restartBot} className="text-xs font-mono text-slate-500 hover:text-slate-300 border border-slate-700 px-3 py-1.5 rounded-lg transition">↺ Restart Bot</button>
          </div>
        )}

        {/* Setup options */}
        {!isRunning && (
          <div className="space-y-4">
            <div className="text-sm text-slate-400 mb-4">To start the Signal bot, either link an existing Signal account or register a new number.</div>

            {/* Captcha setup */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Option A — Register New Number</div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Phone Number (international format)</label>
                  <input value={number} onChange={e => setNumber(e.target.value)} placeholder="+12345678901" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500/50" />
                </div>
                {step !== 'verify' && (
                  <>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Captcha token (if required)</label>
                      <input value={captcha} onChange={e => setCaptcha(e.target.value)} placeholder="signalcaptcha://..." className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-400 focus:outline-none" />
                      <a href="/signal-captcha" target="_blank" className="text-xs text-blue-400 hover:underline mt-1 block">Get captcha token →</a>
                    </div>
                    <button onClick={doRegister} disabled={loading || !number} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                      {loading ? 'Sending SMS...' : 'Send Verification SMS'}
                    </button>
                  </>
                )}
                {step === 'verify' && (
                  <div className="space-y-3 border-t border-slate-800 pt-3">
                    <div className="text-xs text-green-400">{msg}</div>
                    <input value={code} onChange={e => setCode(e.target.value)} placeholder="123456" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-green-500/50" />
                    <button onClick={doVerify} disabled={loading || !code} className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                      {loading ? 'Verifying...' : 'Verify Code'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Link device */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Option B — Link Existing Account</div>
              {step === 'linking' && linkState?.uri ? (
                <div>
                  <div className="text-xs text-slate-400 mb-3">{msg}</div>
                  <div className="bg-slate-950 border border-slate-700 rounded-xl p-3 font-mono text-xs text-blue-400 break-all mb-3">{linkState.uri}</div>
                  <div className="text-xs text-slate-500">Waiting for you to scan...</div>
                  <div className="mt-2 w-full bg-slate-800 rounded-full h-1 overflow-hidden"><div className="h-1 bg-blue-500 animate-pulse w-full" /></div>
                </div>
              ) : step === 'linked' ? (
                <div className="text-green-400 text-sm">{msg}</div>
              ) : (
                <>
                  <div className="text-sm text-slate-400 mb-3">In your Signal app: Settings → Linked Devices → Link a Device, then scan the QR.</div>
                  <button onClick={doLink} disabled={loading} className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 font-semibold py-2.5 rounded-xl transition text-sm">
                    {loading ? 'Generating link...' : '🔗 Generate Link QR'}
                  </button>
                </>
              )}
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm font-mono">{error}</div>}
            {msg && step !== 'verify' && step !== 'linking' && <div className="text-green-400 text-sm font-mono">{msg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
