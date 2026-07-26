import { useState, useRef } from 'react';

const TEMPLATES = [
  { id: 'http/technologies', label: 'Tech Detection', desc: 'Identify CMS, frameworks, servers' },
  { id: 'http/misconfiguration', label: 'Misconfigurations', desc: 'Security misconfigs & weak settings' },
  { id: 'http/exposures', label: 'Exposed Files', desc: '.env, backups, config files exposed' },
  { id: 'http/cves', label: 'CVEs', desc: 'Known CVE vulnerabilities' },
  { id: 'http/takeovers', label: 'Subdomain Takeover', desc: 'Dangling DNS & subdomain takeover' },
  { id: 'dns', label: 'DNS', desc: 'DNS zone transfer, rebinding, records' },
];

export default function NucleiPage() {
  
  const [target, setTarget] = useState('');
  const [templates, setTemplates] = useState(['http/technologies', 'http/exposures']);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  function addLog(msg, type = 'info') {
    setLogs(prev => [...prev, { msg, type }]);
    setTimeout(() => logRef.current?.scrollTo(0, 99999), 50);
  }

  function toggleTemplate(id) {
    setTemplates(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }

  async function runScan() {
    const t = target.trim();
    if (!t) return;
    setLoading(true); setError(''); setResult(null); setLogs([]);
    addLog(`[NUCLEI] v3.11.0 — Target: ${t}`);
    addLog(`[NUCLEI] Templates: ${templates.join(', ')}`);
    addLog('[NUCLEI] Updating template cache...');
    try {
      const r = await fetch('/api/tools/nuclei', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t, templates }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Scan failed');
      d.data.findings?.forEach(f => addLog(`[${f.severity?.toUpperCase()}] ${f.templateId} — ${f.matched}`, f.severity === 'critical' || f.severity === 'high' ? 'warn' : 'info'));
      addLog(`[NUCLEI] Done — ${d.data.findings?.length ?? 0} findings`);
      setResult(d.data);
    } catch (e) { setError(e.message); addLog(`[NUCLEI] ERROR: ${e.message}`, 'error'); }
    finally { setLoading(false); }
  }

  const SEV_COLOR = {
    critical: 'text-red-400 bg-red-500/10 border-red-500/40',
    high: 'text-orange-400 bg-orange-500/10 border-orange-500/40',
    medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/40',
    low: 'text-blue-400 bg-blue-500/10 border-blue-500/40',
    info: 'text-slate-400 bg-slate-500/10 border-slate-500/40',
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-xl">☢️</span>
        <span className="font-bold">Nuclei Scanner</span>
        <span className="text-xs font-mono text-slate-500">PROJECTDISCOVERY/NUCLEI v3.11.0</span>
        <span className="text-xs bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded font-mono">BINARY INSTALLED</span>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-2 text-sm text-slate-400">
          Template-based vulnerability scanning — CVEs, misconfigurations, exposed files, tech detection.
        </div>
        <div className="text-xs text-amber-400/70 font-mono mb-6">⚠️ Authorized targets only — illegal use prohibited</div>

        {/* Target */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4">
          <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Target</div>
          <div className="flex gap-2">
            <input
              value={target}
              onChange={e => setTarget(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runScan()}
              placeholder="https://example.com"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-red-500/50"
            />
            <button
              onClick={runScan}
              disabled={loading || templates.length === 0}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition text-sm flex items-center gap-2"
            >
              {loading ? <><span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Scanning</> : '☢️ Scan'}
            </button>
          </div>
        </div>

        {/* Template selector */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
          <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Template Categories</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => toggleTemplate(t.id)}
                className={`text-left p-3 rounded-xl border transition text-sm ${
                  templates.includes(t.id)
                    ? 'bg-red-500/10 border-red-500/40 text-red-400'
                    : 'bg-slate-950 border-slate-700 text-slate-500 hover:border-slate-600'
                }`}
              >
                <div className="font-semibold mb-0.5">{t.label}</div>
                <div className="text-xs opacity-70">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Log console */}
        {logs.length > 0 && (
          <div ref={logRef} className="bg-black border border-slate-800 rounded-xl p-4 mb-6 font-mono text-xs max-h-48 overflow-y-auto">
            {logs.map((l, i) => (
              <div key={i} className={l.type === 'error' ? 'text-red-400' : l.type === 'warn' ? 'text-orange-400' : 'text-green-400'}>{l.msg}</div>
            ))}
            {loading && <div className="text-yellow-400 animate-pulse">▌</div>}
          </div>
        )}

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-6 text-sm font-mono">{error}</div>}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Critical', value: result.findings?.filter(f => f.severity === 'critical').length ?? 0, color: 'text-red-400' },
                { label: 'High', value: result.findings?.filter(f => f.severity === 'high').length ?? 0, color: 'text-orange-400' },
                { label: 'Medium', value: result.findings?.filter(f => f.severity === 'medium').length ?? 0, color: 'text-yellow-400' },
                { label: 'Info/Low', value: result.findings?.filter(f => ['low','info'].includes(f.severity)).length ?? 0, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
                  <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">{s.label}</div>
                  <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {result.findings?.length > 0 ? (
              <div className="space-y-2">
                {result.findings.map((f, i) => (
                  <div key={i} className={`border rounded-xl p-4 ${SEV_COLOR[f.severity] || SEV_COLOR.info}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-mono text-sm font-bold">{f.templateId}</div>
                      <span className="text-xs font-mono uppercase">{f.severity}</span>
                    </div>
                    <div className="text-xs font-mono opacity-80 mb-1">{f.matched}</div>
                    {f.description && <div className="text-xs opacity-70">{f.description}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500 font-mono text-sm">✅ No findings — target appears clean for selected templates</div>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-16 text-slate-600">
            <div className="text-5xl mb-4">☢️</div>
            <div className="font-mono text-sm">Select templates and enter a target to scan</div>
          </div>
        )}
      </div>
    </div>
  );
}
