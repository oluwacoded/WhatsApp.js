import { useState, useRef } from 'react';

export default function MetatronPage() {
  
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  function addLog(msg, type = 'info') {
    setLogs(prev => [...prev, { msg, type }]);
    setTimeout(() => logRef.current?.scrollTo(0, 99999), 50);
  }

  async function scan() {
    const t = target.trim();
    if (!t) return;
    setLoading(true); setError(''); setResult(null); setLogs([]);
    addLog(`[METATRON] Target: ${t}`);
    addLog('[METATRON] Running DNS enumeration...');
    addLog('[METATRON] Checking HTTP headers & tech stack...');
    addLog('[METATRON] Feeding to AI for analysis...');
    try {
      const r = await fetch('/api/tools/metatron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Scan failed');
      addLog('[METATRON] ✅ AI analysis complete');
      setResult(d.data);
    } catch (e) { setError(e.message); addLog(`[METATRON] ERROR: ${e.message}`, 'error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-xl">🔱</span>
        <span className="font-bold">Metatron Pentest AI</span>
        <span className="text-xs font-mono text-slate-500">SOORYATHEJAS/METATRON</span>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-2 text-sm text-slate-400">
          AI-powered recon — DNS, HTTP headers, TLS, tech fingerprinting, then Groq AI analysis for vulnerabilities.
        </div>
        <div className="text-xs text-amber-400/70 font-mono mb-6">⚠️ Authorized targets only</div>

        <div className="flex gap-2 mb-6">
          <input
            value={target}
            onChange={e => setTarget(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && scan()}
            placeholder="example.com or 192.168.1.1"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-orange-500/50"
          />
          <button
            onClick={scan}
            disabled={loading}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition text-sm flex items-center gap-2"
          >
            {loading ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Scanning</> : '🔱 Analyze'}
          </button>
        </div>

        {/* Log console */}
        {logs.length > 0 && (
          <div ref={logRef} className="bg-black border border-slate-800 rounded-xl p-4 mb-6 font-mono text-xs max-h-32 overflow-y-auto">
            {logs.map((l, i) => (
              <div key={i} className={l.type === 'error' ? 'text-red-400' : 'text-orange-400'}>{l.msg}</div>
            ))}
            {loading && <div className="text-yellow-400 animate-pulse">▌</div>}
          </div>
        )}

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-6 text-sm font-mono">{error}</div>}

        {result && (
          <div className="space-y-4">
            {/* Target info */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { k: 'Target', v: result.target },
                { k: 'IP', v: result.ip },
                { k: 'Status', v: result.httpStatus ? `HTTP ${result.httpStatus}` : 'N/A' },
                { k: 'Server', v: result.server || 'Unknown' },
                { k: 'TLS', v: result.tls ? `✅ TLS ${result.tlsVersion || ''}` : '❌ No TLS' },
                { k: 'Tech', v: result.tech?.join(', ') || 'Unknown' },
              ].map(({ k, v }) => (
                <div key={k} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">{k}</div>
                  <div className="text-sm font-mono text-slate-100 break-all">{v || '—'}</div>
                </div>
              ))}
            </div>

            {/* DNS */}
            {result.dns && Object.keys(result.dns).length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">DNS Records</div>
                <div className="space-y-2">
                  {Object.entries(result.dns).map(([type, records]) => (
                    <div key={type} className="flex gap-3 text-xs font-mono">
                      <span className="text-orange-400 w-10">{type}</span>
                      <span className="text-slate-300">{Array.isArray(records) ? records.join(', ') : records}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Headers */}
            {result.headers && Object.keys(result.headers).length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">HTTP Headers (Security)</div>
                <div className="space-y-1.5">
                  {Object.entries(result.headers).map(([k, v]) => (
                    <div key={k} className="flex gap-3 text-xs font-mono">
                      <span className="text-slate-500 w-40 shrink-0">{k}:</span>
                      <span className="text-slate-300 break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Analysis */}
            {result.aiAnalysis && (
              <div className="bg-gradient-to-br from-orange-500/5 to-red-500/5 border border-orange-500/20 rounded-xl p-5">
                <div className="text-xs font-mono text-orange-400 uppercase tracking-widest mb-3">🔱 Metatron AI Analysis (Groq)</div>
                <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{result.aiAnalysis}</div>
              </div>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-16 text-slate-600">
            <div className="text-5xl mb-4">🔱</div>
            <div className="font-mono text-sm">Enter a domain or IP to start AI-powered recon</div>
          </div>
        )}
      </div>
    </div>
  );
}
