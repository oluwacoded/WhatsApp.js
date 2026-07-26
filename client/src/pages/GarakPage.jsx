import { useState, useRef } from 'react';

const PROBES = [
  { id: 'jailbreak', label: 'Jailbreak', desc: 'DAN, AIM, developer mode bypasses', icon: '🔓' },
  { id: 'prompt_injection', label: 'Prompt Injection', desc: 'Indirect injection, leakage attacks', icon: '💉' },
  { id: 'data_leakage', label: 'Data Leakage', desc: 'System prompt extraction, PII leaks', icon: '🚿' },
  { id: 'hallucination', label: 'Hallucination', desc: 'False confidence, fabricated facts', icon: '💭' },
  { id: 'toxicity', label: 'Toxicity', desc: 'Hate speech, harmful content gen', icon: '☠️' },
  { id: 'malware', label: 'Malware Gen', desc: 'Shellcode, exploit gen attempts', icon: '🦠' },
];

const MODELS = [
  { id: 'openai', label: 'OpenAI-compat (custom key)', placeholder: 'https://api.openai.com/v1' },
  { id: 'groq', label: 'Groq API', placeholder: 'https://api.groq.com/openai/v1' },
  { id: 'ollama', label: 'Ollama (local)', placeholder: 'http://localhost:11434/v1' },
  { id: 'custom', label: 'Custom endpoint', placeholder: 'http://your-llm-endpoint/v1' },
];

export default function GarakPage() {
  
  const [modelType, setModelType] = useState('groq');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('llama-3.3-70b-versatile');
  const [probes, setProbes] = useState(['jailbreak', 'prompt_injection']);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  function addLog(msg, type = 'info') {
    setLogs(prev => [...prev, { msg, type }]);
    setTimeout(() => logRef.current?.scrollTo(0, 99999), 50);
  }

  function toggleProbe(id) {
    setProbes(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  }

  async function runProbe() {
    if (probes.length === 0) return;
    setLoading(true); setError(''); setResult(null); setLogs([]);
    addLog('[GARAK] Initializing LLM security probe...');
    addLog(`[GARAK] Model: ${modelType} / ${model}`);
    addLog(`[GARAK] Probes: ${probes.join(', ')}`);
    try {
      const r = await fetch('/api/tools/garak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelType, endpoint, apiKey, model, probes }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Probe failed');
      d.data.results?.forEach(r => {
        const pass = r.passed / (r.total || 1);
        addLog(`[${r.probe}] ${r.passed}/${r.total} safe (${(pass*100).toFixed(0)}%)`, pass < 0.7 ? 'warn' : 'ok');
      });
      addLog('[GARAK] ✅ Probe complete');
      setResult(d.data);
    } catch (e) { setError(e.message); addLog(`[GARAK] ERROR: ${e.message}`, 'error'); }
    finally { setLoading(false); }
  }

  const selectedModel = MODELS.find(m => m.id === modelType);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-xl">👁️</span>
        <span className="font-bold">Garak LLM Probe</span>
        <span className="text-xs font-mono text-slate-500">NVIDIA/GARAK</span>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-2 text-sm text-slate-400">
          Red-team any LLM API — jailbreaks, prompt injection, data leakage, hallucination, toxicity probing.
        </div>
        <div className="text-xs text-amber-400/70 font-mono mb-6">⚠️ Authorized LLM endpoints only</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Model config */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">LLM Target</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Provider</label>
                <select
                  value={modelType}
                  onChange={e => setModelType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-300 focus:outline-none"
                >
                  {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              {(modelType === 'custom' || modelType === 'ollama') && (
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Endpoint URL</label>
                  <input
                    value={endpoint}
                    onChange={e => setEndpoint(e.target.value)}
                    placeholder={selectedModel?.placeholder}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              )}
              {(modelType === 'openai' || modelType === 'custom') && (
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">API Key</label>
                  <input
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    type="password"
                    placeholder="sk-..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Model Name</label>
                <input
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="llama-3.3-70b-versatile"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>
          </div>

          {/* Probe selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Probe Types</div>
            <div className="space-y-2">
              {PROBES.map(p => (
                <button
                  key={p.id}
                  onClick={() => toggleProbe(p.id)}
                  className={`w-full text-left p-2.5 rounded-xl border transition flex items-center gap-2 ${
                    probes.includes(p.id)
                      ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400'
                      : 'bg-slate-950 border-slate-700 text-slate-500 hover:border-slate-600'
                  }`}
                >
                  <span>{p.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="text-xs opacity-70 truncate">{p.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={runProbe}
          disabled={loading || probes.length === 0}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition text-sm flex items-center justify-center gap-2 mb-6"
        >
          {loading ? <><span className="w-4 h-4 border border-white/30 border-t-white rounded-full animate-spin" />Running Probes...</> : '👁️ Launch Probe'}
        </button>

        {/* Log console */}
        {logs.length > 0 && (
          <div ref={logRef} className="bg-black border border-slate-800 rounded-xl p-4 mb-6 font-mono text-xs max-h-40 overflow-y-auto">
            {logs.map((l, i) => (
              <div key={i} className={l.type === 'error' ? 'text-red-400' : l.type === 'warn' ? 'text-orange-400' : l.type === 'ok' ? 'text-green-400' : 'text-cyan-400'}>{l.msg}</div>
            ))}
            {loading && <div className="text-yellow-400 animate-pulse">▌</div>}
          </div>
        )}

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-6 text-sm font-mono">{error}</div>}

        {result && (
          <div className="space-y-4">
            {/* Overall score */}
            <div className={`border rounded-xl p-5 ${result.overallScore >= 80 ? 'border-green-500/30 bg-green-500/5' : result.overallScore >= 50 ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-1">Overall Safety Score</div>
                  <div className={`text-4xl font-black ${result.overallScore >= 80 ? 'text-green-400' : result.overallScore >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {result.overallScore?.toFixed(0)}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500 mb-1">{result.totalTests} prompts tested</div>
                  <div className="text-xs text-slate-500">{result.failed} vulnerabilities found</div>
                </div>
              </div>
            </div>

            {/* Per-probe results */}
            {result.results?.map((r, i) => {
              const pct = r.total > 0 ? Math.round(r.passed / r.total * 100) : 100;
              return (
                <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold capitalize">{r.probe?.replace('_', ' ')}</div>
                    <div className={`text-sm font-bold ${pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>{pct}% safe</div>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 mb-2">
                    <div className={`h-2 rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-xs text-slate-500">{r.passed}/{r.total} prompts resisted</div>
                  {r.examples?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {r.examples.map((ex, j) => (
                        <div key={j} className="text-xs font-mono text-red-400 bg-red-500/5 rounded p-2 border border-red-500/20">
                          ⚠️ {ex}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-12 text-slate-600">
            <div className="text-5xl mb-4">👁️</div>
            <div className="font-mono text-sm">Configure a target LLM and select probes to begin</div>
          </div>
        )}
      </div>
    </div>
  );
}
