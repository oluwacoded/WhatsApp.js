import { useState, useRef } from 'react';

const RISK_COLOR = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  low: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  info: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

function riskLevel(score) {
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 5) return 'medium';
  if (score >= 3) return 'low';
  return 'info';
}

export default function AimapPage() {
  
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  function addLog(msg, type = 'info') {
    setLogs(prev => [...prev, { msg, type, t: Date.now() }]);
    setTimeout(() => logRef.current?.scrollTo(0, 99999), 50);
  }

  async function scan() {
    const t = target.trim();
    if (!t) return;
    setLoading(true); setError(''); setResult(null); setLogs([]);
    addLog(`[AIMAP] Starting scan → ${t}`);
    addLog(`[AIMAP] Probing for exposed AI endpoints...`);
    try {
      const r = await fetch('/api/tools/aimap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Scan failed');
      addLog(`[AIMAP] Scan complete — ${d.data.endpoints?.length || 0} endpoints found`);
      setResult(d.data);
    } catch (e) { setError(e.message); addLog(`[AIMAP] ERROR: ${e.message}`, 'error'); }
    finally { setLoading(false); }
  }

  const PROTOCOLS = ['Ollama', 'vLLM', 'LangServe', 'MCP', 'OpenAI-Compat', 'Gradio', 'AutoGen'];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-xl">🤖</span>
        <span className="font-bold">AI Attack Surface Map</span>
        <span className="text-xs font-mono text-slate-500">AIMAP — BishopFox</span>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-2 text-sm text-slate-400">
          Probe a host for exposed AI infrastructure — Ollama, vLLM, LangServe, MCP servers, AutoGen, and more.
        </div>
        <div className="text-xs text-amber-400/70 font-mono mb-6">⚠️ Authorized targets only</div>

        <div className="flex gap-2 mb-6">
          <input
            value={target}
            onChange={e => setTarget(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && scan()}
            placeholder="192.168.1.1  or  myserver.com  or  http://ai.example.com"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
          />
          <button
            onClick={scan}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition text-sm flex items-center gap-2"
          >
            {loading ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Scanning</> : '🔍 Scan'}
          </button>
        </div>

        {/* Protocols badge row */}
        <div className="flex flex-wrap gap-2 mb-6">
          {PROTOCOLS.map(p => (
            <span key={p} className="text-xs font-mono bg-slate-900 border border-slate-800 text-slate-500 px-2 py-1 rounded">{p}</span>
          ))}
        </div>

        {/* Log console */}
        {logs.length > 0 && (
          <div ref={logRef} className="bg-black border border-slate-800 rounded-xl p-4 mb-6 font-mono text-xs max-h-36 overflow-y-auto">
            {logs.map((l, i) => (
              <div key={i} className={l.type === 'error' ? 'text-red-400' : 'text-green-400'}>{l.msg}</div>
            ))}
            {loading && <div className="text-yellow-400 animate-pulse">▌</div>}
          </div>
        )}

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-6 text-sm font-mono">{error}</div>}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Target', value: result.target, mono: true },
                { label: 'Endpoints Found', value: result.endpoints?.length ?? 0 },
                { label: 'Avg Risk Score', value: result.avgRisk?.toFixed(1) ?? 'N/A' },
                { label: 'Scan Time', value: result.duration ? `${result.duration}ms` : 'N/A', mono: true },
              ].map(s => (
                <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">{s.label}</div>
                  <div className={`text-lg font-bold text-slate-100 ${s.mono ? 'font-mono text-sm' : ''}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Endpoints */}
            {result.endpoints?.length > 0 ? (
              <div className="space-y-3">
                {result.endpoints.map((ep, i) => {
                  const level = riskLevel(ep.riskScore || 0);
                  return (
                    <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-mono text-sm text-slate-100">{ep.url}</div>
                        <div className={`text-xs font-mono px-2 py-0.5 rounded border ${RISK_COLOR[level]}`}>
                          RISK {ep.riskScore?.toFixed(1) ?? '?'} · {level.toUpperCase()}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ep.protocol && <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono">{ep.protocol}</span>}
                        {ep.auth === false && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-mono">NO AUTH</span>}
                        {ep.tls === false && <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded font-mono">NO TLS</span>}
                        {ep.models?.map(m => <span key={m} className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">{m}</span>)}
                        {ep.status && <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded font-mono">HTTP {ep.status}</span>}
                      </div>
                      {ep.notes && <div className="text-xs text-slate-500 mt-2 font-mono">{ep.notes}</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-600 font-mono text-sm">No exposed AI endpoints found at this target.</div>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-16 text-slate-600">
            <div className="text-5xl mb-4">🤖</div>
            <div className="font-mono text-sm">Enter a target to discover exposed AI infrastructure</div>
          </div>
        )}
      </div>
    </div>
  );
}
