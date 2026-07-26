import { useState } from 'react';

const FLAG = (cc) => cc ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0))) : '🌐';

export default function GeolocationPage() {
  
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);

  async function lookup(q) {
    const target = (q || query).trim();
    if (!target) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetch(`/api/geo/lookup?q=${encodeURIComponent(target)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Lookup failed');
      setResult(d.data);
      setHistory(prev => [{ q: target, cc: d.data.countryCode }, ...prev].slice(0, 8));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const Field = ({ label, value, mono }) => value ? (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs text-slate-500 uppercase tracking-widest">{label}</div>
      <div className={`text-sm text-slate-100 ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex items-center gap-3">
        <button onClick={() => window.location.href = '/tools'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Tools</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-xl">🌍</span>
        <span className="font-bold">Geolocation Tool</span>
        <span className="text-xs font-mono text-slate-500">NETRYX-ASTRA-V2</span>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Search */}
        <div className="mb-6">
          <div className="text-sm text-slate-400 mb-3">Enter an IP address or domain name</div>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookup()}
              placeholder="8.8.8.8 or google.com or 2001:4860:4860::8888"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={() => lookup()}
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl transition text-sm"
            >
              {loading ? '...' : 'Lookup'}
            </button>
          </div>

          {/* Quick examples */}
          <div className="flex gap-2 mt-2 flex-wrap">
            {['8.8.8.8','1.1.1.1','github.com','api.telegram.org'].map(q => (
              <button key={q} onClick={() => { setQuery(q); lookup(q); }} className="text-xs text-slate-500 hover:text-emerald-400 font-mono bg-slate-900 border border-slate-800 px-2 py-1 rounded-lg transition">{q}</button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 mb-6 text-sm font-mono">{error}</div>}

        {/* Result */}
        {result && (
          <div className="space-y-4">
            {/* Hero card */}
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="text-5xl">{FLAG(result.countryCode)}</div>
                <div>
                  <div className="text-2xl font-bold font-mono text-emerald-400">{result.query}</div>
                  <div className="text-slate-400">{result.city && `${result.city}, `}{result.regionName && `${result.regionName}, `}{result.country}</div>
                  <div className="flex gap-2 mt-1">
                    {result.hosting && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-mono">HOSTING/VPN</span>}
                    {result.proxy && <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded font-mono">PROXY</span>}
                    {result.mobile && <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono">MOBILE</span>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="IP Address" value={result.query} mono />
                <Field label="Country" value={result.country} />
                <Field label="Country Code" value={result.countryCode} mono />
                <Field label="Region" value={result.regionName} />
                <Field label="City" value={result.city} />
                <Field label="Postal Code" value={result.zip} mono />
                <Field label="Timezone" value={result.timezone} />
                <Field label="Latitude" value={result.lat?.toFixed(4)} mono />
                <Field label="Longitude" value={result.lon?.toFixed(4)} mono />
              </div>
            </div>

            {/* Network info */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Network Info</div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="ISP" value={result.isp} />
                <Field label="Organization" value={result.org} />
                <Field label="ASN" value={result.as} mono />
              </div>
            </div>

            {/* Map link */}
            {result.lat && result.lon && (
              <a
                href={`https://maps.google.com/?q=${result.lat},${result.lon}`}
                target="_blank"
                rel="noreferrer"
                className="block bg-slate-900 border border-slate-800 hover:border-emerald-500/30 rounded-xl p-4 text-center text-sm text-slate-400 hover:text-emerald-400 transition"
              >
                📍 View on Google Maps ({result.lat?.toFixed(4)}, {result.lon?.toFixed(4)})
              </a>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && !result && (
          <div>
            <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Recent Lookups</div>
            <div className="flex gap-2 flex-wrap">
              {history.map((h, i) => (
                <button key={i} onClick={() => { setQuery(h.q); lookup(h.q); }} className="flex items-center gap-1.5 text-xs font-mono text-slate-400 hover:text-emerald-400 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg transition">
                  <span>{FLAG(h.cc)}</span>{h.q}
                </button>
              ))}
            </div>
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center py-16 text-slate-600">
            <div className="text-5xl mb-4">🌍</div>
            <div className="font-mono text-sm">Enter an IP or domain to geolocate</div>
          </div>
        )}
      </div>
    </div>
  );
}
