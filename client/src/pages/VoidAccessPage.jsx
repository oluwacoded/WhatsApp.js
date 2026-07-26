import { useState, useRef } from 'react';

const CATEGORIES = ['threat actor', 'ransomware', 'CVE', 'breach', 'IOC', 'malware', 'darkweb', 'credentials'];

export default function VoidAccessPage() {
  
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState('shallow');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  function addLog(msg, type = 'info') {
    setLogs(prev => [...prev, { msg, type }]);
    setTimeout(() => logRef.current?.scrollTo(0, 99999), 50);
  }

  async function investigate() {
    const q = query.trim();
    if (!q) return;
    setLoading(true); setError(''); setResult(null); setLogs([]);
    addLog(`[VOID] Query: "${q}" (depth: ${depth})`);
    addLog('[VOID] Searching OSINT sources...');
    try {
      const r = await fetch('/api/tools/voidaccess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, depth }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Investigation failed');
      addLog(`[VOID] Complete — ${d.data.sources?.length || 0} sources, ${d.data.iocs?.length || 0} IOCs`);
      setResult(d.data);
    } catch (e) { setError(e.message); addLog(`[VOID] ERROR: ${e.message}`, 'error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-xl">🕳️</span>
        <span className="font-bold">VoidAccess OSINT</span>
        <span className="text-xs font-mono text-slate-500">KATRIELMOSES/VOIDACCESS</span>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-2 text-sm text-slate-400">
          Open-source intelligence — threat actors, breach data, IOC enrichment, CVE lookups, dark web research.
        </div>
        <div className="text-xs text-amber-400/70 font-mono mb-6">⚠️ For authorized threat intelligence research only</div>

        {/* Search */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <div className="flex gap-3 mb-3">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && investigate()}
              placeholder='e.g. "LockBit ransomware" or "CVE-2024-1234" or "cobalt strike"'
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-purple-500/50"
            />
            <select
              value={depth}
              onChange={e => setDepth(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm text-slate-300 focus:outline-none"
            >
              <option value="shallow">Shallow</option>
              <option value="deep">Deep</option>
            </select>
            <button
              onClick={investigate}
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl transition text-sm flex items-center gap-2"
            >
              {loading ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Searching</> : '🔍 Investigate'}
            </button>
          </div>

          {/* Category pills */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setQuery(c)} className="text-xs font-mono bg-slate-800 hover:bg-purple-900/30 text-slate-500 hover:text-purple-400 border border-slate-700 hover:border-purple-500/30 px-2 py-1 rounded transition">{c}</button>
            ))}
          </div>
        </div>

        {/* Log console */}
        {logs.length > 0 && (
          <div ref={logRef} className="bg-black border border-slate-800 rounded-xl p-4 mb-6 font-mono text-xs max-h-32 overflow-y-auto">
            {logs.map((l, i) => (
              <div key={i} className={l.type === 'error' ? 'text-red-400' : 'text-purple-400'}>{l.msg}</div>
            ))}
            {loading && <div className="text-yellow-400 animate-pulse">▌</div>}
          </div>
        )}

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-6 text-sm font-mono">{error}</div>}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Sources Checked', value: result.sources?.length ?? 0 },
                { label: 'IOCs Found', value: result.iocs?.length ?? 0 },
                { label: 'Threat Score', value: result.threatScore ?? 'N/A' },
              ].map(s => (
                <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">{s.label}</div>
                  <div className="text-2xl font-bold text-slate-100">{s.value}</div>
                </div>
              ))}
            </div>

            {/* Summary text */}
            {result.summary && (
              <div className="bg-slate-900 border border-purple-500/20 rounded-xl p-5">
                <div className="text-xs font-mono text-purple-400 uppercase tracking-widest mb-2">AI Summary</div>
                <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{result.summary}</div>
              </div>
            )}

            {/* IOCs */}
            {result.iocs?.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Indicators of Compromise</div>
                <div className="space-y-2">
                  {result.iocs.map((ioc, i) => (
                    <div key={i} className="flex items-center gap-3 font-mono text-xs">
                      <span className={`px-2 py-0.5 rounded border ${
                        ioc.type === 'ip' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                        ioc.type === 'domain' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
                        ioc.type === 'hash' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                        ioc.type === 'cve' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
                        'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>{ioc.type?.toUpperCase()}</span>
                      <span className="text-slate-300 flex-1 break-all">{ioc.value}</span>
                      {ioc.confidence && <span className="text-slate-600">{ioc.confidence}%</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sources */}
            {result.sources?.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Sources</div>
                <div className="space-y-2">
                  {result.sources.map((src, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-slate-600 font-mono text-xs mt-0.5">{String(i+1).padStart(2,'0')}</span>
                      <div>
                        <div className="text-slate-300">{src.title}</div>
                        {src.url && <a href={src.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline font-mono break-all">{src.url}</a>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-16 text-slate-600">
            <div className="text-5xl mb-4">🕳️</div>
            <div className="font-mono text-sm">Enter a query to start OSINT investigation</div>
          </div>
        )}
      </div>
    </div>
  );
}
