import { useState, useEffect, useRef } from 'react';

const TABS = ['Credentials', 'Login', 'Campaign', 'Groups', 'Log'];

export default function TelegramPage() {
  const [tab, setTab] = useState('Credentials');
  const [status, setStatus] = useState(null);

  // Credentials
  const [apiId, setApiId]     = useState('');
  const [apiHash, setApiHash] = useState('');
  const [credMsg, setCredMsg] = useState('');

  // Login
  const [phone, setPhone]       = useState('');
  const [code, setCode]         = useState('');
  const [twofa, setTwofa]       = useState('');
  const [loginStep, setLoginStep] = useState('idle'); // idle | awaiting_code | awaiting_2fa | done
  const [loginMsg, setLoginMsg] = useState('');

  // Campaign
  const [campMode, setCampMode] = useState('manual'); // manual | vcf
  const [campContacts, setCampContacts] = useState(''); // one per line: +2349... Name
  const [campVcf, setCampVcf]   = useState('');
  const [campMsg, setCampMsg]   = useState('');
  const [campRes, setCampRes]   = useState(null);

  // Groups
  const [scrapeGroup, setScrapeGroup]   = useState('');
  const [scraped, setScraped]           = useState(null);
  const [addGroup, setAddGroup]         = useState('');
  const [addUsernames, setAddUsernames] = useState('');
  const [addRes, setAddRes]             = useState(null);
  const [groupLoading, setGroupLoading] = useState(false);

  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (status?.log?.length && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
    // Auto-detect login stage from log
    if (status?.log) {
      const latest = status.log.at(-1)?.msg || '';
      if (latest.includes('login code') && loginStep === 'idle') setLoginStep('awaiting_code');
      if (latest.includes('2FA') || latest.includes('2fa')) setLoginStep('awaiting_2fa');
      if (latest.includes('connected') || status?.connected) setLoginStep('done');
    }
  }, [status]);

  async function poll() {
    try {
      const r = await fetch('/api/tg/status');
      const d = await r.json();
      setStatus(d);
    } catch {}
  }

  async function saveCredentials() {
    if (!apiId.trim() || !apiHash.trim()) return setCredMsg('Both API ID and API Hash are required');
    setBusy(true); setError(''); setCredMsg('');
    try {
      const r = await fetch('/api/tg/save-credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: apiId.trim(), apiHash: apiHash.trim() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setCredMsg('✅ Credentials saved! Now go to Login tab.');
      setTimeout(poll, 1000);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function startLogin() {
    if (!phone.trim()) return setError('Enter your phone number');
    setBusy(true); setError(''); setLoginMsg('');
    try {
      const r = await fetch('/api/tg/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      if (d.already) { setLoginStep('done'); setLoginMsg('Already connected!'); return; }
      setLoginStep('awaiting_code');
      setLoginMsg('📲 Telegram is sending you a code. Enter it below.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function submitCode() {
    if (!code.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/tg/submit-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setCode('');
      setLoginMsg('Code submitted — waiting for Telegram...');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function submit2FA() {
    if (!twofa.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/tg/submit-2fa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: twofa }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setTwofa('');
      setLoginMsg('2FA submitted — connecting...');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    await fetch('/api/tg/disconnect', { method: 'POST' }).catch(() => {});
    setLoginStep('idle'); setLoginMsg('Disconnected.');
    setBusy(false); setTimeout(poll, 1000);
  }

  async function startCampaign() {
    if (!campMsg.trim()) return setError('Enter a message template');
    setBusy(true); setError('');
    try {
      let body = { message: campMsg };
      if (campMode === 'vcf') {
        if (!campVcf.trim()) throw new Error('Paste your VCF contacts');
        body.vcf = campVcf;
      } else {
        const lines = campContacts.split('\n').map(l => l.trim()).filter(Boolean);
        const contacts = lines.map(l => {
          const parts = l.split(/\s+/);
          const phone = parts[0];
          const name = parts.slice(1).join(' ') || phone;
          return { phone, name };
        });
        if (!contacts.length) throw new Error('Add at least one contact');
        body.contacts = contacts;
      }
      const r = await fetch('/api/tg/campaign/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setCampRes({ started: true, count: d.count });
      setTimeout(poll, 2000);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function stopCampaign() {
    await fetch('/api/tg/campaign/stop', { method: 'POST' }).catch(() => {});
    setCampRes(null); setTimeout(poll, 1000);
  }

  async function scrapeMembers() {
    if (!scrapeGroup.trim()) return setError('Enter group username');
    setGroupLoading(true); setError(''); setScraped(null);
    try {
      const r = await fetch('/api/tg/groups/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupUsername: scrapeGroup.trim() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setScraped(d.members);
      // Auto-fill add field with usernames
      const usernames = d.members.filter(m => m.username).map(m => '@' + m.username).join('\n');
      setAddUsernames(usernames);
    } catch (e) { setError(e.message); }
    finally { setGroupLoading(false); }
  }

  async function addMembers() {
    if (!addGroup.trim() || !addUsernames.trim()) return setError('Fill in both fields');
    setGroupLoading(true); setError(''); setAddRes(null);
    try {
      const usernames = addUsernames.split('\n').map(u => u.trim()).filter(Boolean);
      const r = await fetch('/api/tg/groups/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupUsername: addGroup.trim(), usernames }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setAddRes(d);
    } catch (e) { setError(e.message); }
    finally { setGroupLoading(false); }
  }

  const connected = status?.connected;
  const hasCredentials = status?.hasApiId && status?.hasApiHash;
  const campaign = status?.campaign;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.location.href = '/'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Home</button>
        <div className="w-px h-5 bg-slate-700" />
        <span className="text-xl">✈️</span>
        <span className="font-bold tracking-wide">Telegram MTProto</span>
        <div className={`ml-auto flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-full border ${connected ? 'text-sky-400 bg-sky-500/10 border-sky-500/30' : 'text-slate-500 bg-slate-800 border-slate-700'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-sky-400 animate-pulse' : 'bg-slate-600'}`} />
          {connected ? 'CONNECTED' : 'OFFLINE'}
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-slate-900/40 border-b border-slate-800/60 px-4 py-2 flex flex-wrap gap-4 text-xs font-mono">
        <span className={hasCredentials ? 'text-emerald-400' : 'text-slate-500'}>
          {hasCredentials ? '✓ API Keys Set' : '✗ No API Keys'}
        </span>
        {status?.apiId && <span className="text-slate-400">API ID: {status.apiId}</span>}
        {campaign && (
          <span className="text-amber-400">
            🚀 Campaign: {campaign.sent}/{campaign.total} ({campaign.percent}%) — ~{campaign.remain}m left
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900/30 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => { setTab(t); setError(''); }}
            className={`px-5 py-3 text-xs font-mono tracking-widest whitespace-nowrap transition border-b-2 ${tab === t ? 'text-sky-400 border-sky-500 bg-sky-500/5' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-3 text-sm font-mono">
            {error}
          </div>
        )}

        {/* ── CREDENTIALS ── */}
        {tab === 'Credentials' && (
          <div className="space-y-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <div className="text-xs font-mono text-sky-500 tracking-widest mb-1">STEP 1 — GET YOUR API KEYS</div>
              <ol className="text-sm text-slate-400 space-y-1 mt-3 list-decimal list-inside">
                <li>Go to <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">my.telegram.org/apps</a></li>
                <li>Log in with your Telegram phone number</li>
                <li>Create a new application (any name / platform)</li>
                <li>Copy your <span className="text-slate-200 font-mono">App api_id</span> and <span className="text-slate-200 font-mono">App api_hash</span></li>
              </ol>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="text-xs font-mono text-sky-500 tracking-widest mb-2">STEP 2 — ENTER API KEYS</div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-widest block mb-1.5">API ID (numbers only)</label>
                <input value={apiId} onChange={e => setApiId(e.target.value)} placeholder="12345678"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500/60 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none transition" />
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-widest block mb-1.5">API Hash</label>
                <input value={apiHash} onChange={e => setApiHash(e.target.value)} placeholder="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
                  type="password"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500/60 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-400 focus:outline-none transition" />
              </div>
              <button onClick={saveCredentials} disabled={busy || !apiId || !apiHash}
                className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                {busy ? 'Saving...' : 'Save Credentials'}
              </button>
              {credMsg && <div className="text-emerald-400 text-sm font-mono">{credMsg}</div>}
            </div>
          </div>
        )}

        {/* ── LOGIN ── */}
        {tab === 'Login' && (
          <div className="space-y-4">
            {!hasCredentials && (
              <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl p-4 text-sm">
                ⚠️ Set your API credentials first in the Credentials tab.
              </div>
            )}

            {connected ? (
              <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-5">
                <div className="text-sky-400 font-semibold mb-2">✈️ Telegram Connected</div>
                <div className="text-sm text-slate-400 mb-4">Your MTProto session is active. You can now use Campaign and Groups features.</div>
                <button onClick={disconnect} disabled={busy}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-mono px-4 py-2 rounded-xl transition border border-slate-700">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="text-xs font-mono text-sky-500 tracking-widest">PHONE LOGIN</div>

                {loginStep === 'idle' && (
                  <>
                    <div>
                      <label className="text-xs text-slate-500 uppercase tracking-widest block mb-1.5">Phone Number</label>
                      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+2349132883869"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500/60 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none transition" />
                    </div>
                    <button onClick={startLogin} disabled={busy || !phone || !hasCredentials}
                      className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                      {busy ? 'Connecting...' : 'Send Login Code'}
                    </button>
                  </>
                )}

                {loginStep === 'awaiting_code' && (
                  <>
                    <div className="text-sm text-slate-300">{loginMsg || '📲 Check your Telegram app for the login code.'}</div>
                    <div>
                      <label className="text-xs text-slate-500 uppercase tracking-widest block mb-1.5">Verification Code</label>
                      <input value={code} onChange={e => setCode(e.target.value)} placeholder="12345"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500/60 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none transition" />
                    </div>
                    <button onClick={submitCode} disabled={busy || !code}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                      Submit Code
                    </button>
                  </>
                )}

                {loginStep === 'awaiting_2fa' && (
                  <>
                    <div className="text-sm text-slate-300">🔐 2FA is enabled on your account. Enter your cloud password.</div>
                    <div>
                      <label className="text-xs text-slate-500 uppercase tracking-widest block mb-1.5">2FA Password</label>
                      <input value={twofa} onChange={e => setTwofa(e.target.value)} type="password" placeholder="Your cloud password"
                        className="w-full bg-slate-950 border border-slate-700 focus:border-purple-500/60 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none transition" />
                    </div>
                    <button onClick={submit2FA} disabled={busy || !twofa}
                      className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                      Submit Password
                    </button>
                  </>
                )}

                {loginStep === 'done' && (
                  <div className="text-emerald-400 font-mono text-sm">✅ {loginMsg || 'Connected!'}</div>
                )}

                {loginMsg && loginStep !== 'done' && (
                  <div className="text-sky-400 text-xs font-mono">{loginMsg}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── CAMPAIGN ── */}
        {tab === 'Campaign' && (
          <div className="space-y-4">
            {!connected && (
              <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl p-4 text-sm">
                ⚠️ Connect your Telegram account first (Login tab).
              </div>
            )}

            {campaign && (
              <div className="bg-sky-500/5 border border-sky-500/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sky-400 font-semibold text-sm">🚀 Campaign Running</span>
                  <button onClick={stopCampaign} className="text-red-400 text-xs border border-red-500/30 px-3 py-1 rounded-lg hover:bg-red-500/10 transition">Stop</button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[['Sent', campaign.sent], ['Failed', campaign.failed], ['Total', campaign.total]].map(([l, v]) => (
                    <div key={l} className="bg-slate-950/50 rounded-lg p-2">
                      <div className="text-[10px] text-slate-500 font-mono">{l}</div>
                      <div className="text-sm font-bold text-slate-200 font-mono">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-sky-500 transition-all" style={{ width: campaign.percent + '%' }} />
                </div>
                <div className="text-xs text-slate-500 font-mono mt-1">{campaign.percent}% — ~{campaign.remain}m remaining</div>
              </div>
            )}

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="text-xs font-mono text-sky-500 tracking-widest">BULK MESSAGE CAMPAIGN</div>

              {/* Mode toggle */}
              <div className="flex gap-2">
                {['manual', 'vcf'].map(m => (
                  <button key={m} onClick={() => setCampMode(m)}
                    className={`flex-1 py-2 rounded-xl text-xs font-mono tracking-widest transition ${campMode === m ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                    {m === 'manual' ? 'MANUAL LIST' : 'VCF FILE'}
                  </button>
                ))}
              </div>

              {campMode === 'manual' ? (
                <div>
                  <label className="text-xs text-slate-500 block mb-1.5">Contacts — one per line: <span className="text-slate-400">+2349... FirstName</span></label>
                  <textarea value={campContacts} onChange={e => setCampContacts(e.target.value)} rows={6}
                    placeholder={"+2349132883869 John\n+2348012345678 Ada\n+447700900123"}
                    className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500/60 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-300 focus:outline-none transition resize-none" />
                  <div className="text-[10px] text-slate-600 mt-1">{campContacts.split('\n').filter(l => l.trim()).length} contacts entered</div>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-slate-500 block mb-1.5">Paste VCF content</label>
                  <textarea value={campVcf} onChange={e => setCampVcf(e.target.value)} rows={6}
                    placeholder="BEGIN:VCARD&#10;FN:John Doe&#10;TEL:+2349132883869&#10;END:VCARD"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500/60 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-300 focus:outline-none transition resize-none" />
                </div>
              )}

              <div>
                <label className="text-xs text-slate-500 block mb-1.5">Message — use <span className="text-sky-400 font-mono">{'{name}'}</span> for personalisation</label>
                <textarea value={campMsg} onChange={e => setCampMsg(e.target.value)} rows={4}
                  placeholder={"Hey {name}! 👋\n\nThis is MFG reaching out..."}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-sky-500/60 rounded-xl px-3 py-2.5 text-sm text-slate-300 focus:outline-none transition resize-none" />
              </div>

              <button onClick={startCampaign} disabled={busy || !connected || !!campaign}
                className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                {busy ? 'Starting...' : campaign ? 'Campaign Running...' : '🚀 Start Campaign'}
              </button>
            </div>
          </div>
        )}

        {/* ── GROUPS ── */}
        {tab === 'Groups' && (
          <div className="space-y-4">
            {!connected && (
              <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl p-4 text-sm">
                ⚠️ Connect your Telegram account first (Login tab).
              </div>
            )}

            {/* Scraper */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="text-xs font-mono text-violet-400 tracking-widest">GROUP MEMBER SCRAPER</div>
              <div>
                <label className="text-xs text-slate-500 block mb-1.5">Source Group (username or @handle)</label>
                <input value={scrapeGroup} onChange={e => setScrapeGroup(e.target.value)} placeholder="@groupname or groupname"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-violet-500/60 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none transition" />
              </div>
              <button onClick={scrapeMembers} disabled={groupLoading || !connected || !scrapeGroup}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                {groupLoading ? 'Scraping...' : '🕸 Scrape Members'}
              </button>

              {scraped && (
                <div>
                  <div className="text-sm text-emerald-400 font-mono mb-2">✅ {scraped.length} members scraped</div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="sticky top-0 bg-slate-900">
                        <tr className="text-slate-500">
                          <th className="text-left px-3 py-2">Username</th>
                          <th className="text-left px-3 py-2">Name</th>
                          <th className="text-left px-3 py-2">Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scraped.map((m, i) => (
                          <tr key={i} className="border-t border-slate-800/50">
                            <td className="px-3 py-1.5 text-sky-400">{m.username ? '@' + m.username : <span className="text-slate-600">—</span>}</td>
                            <td className="px-3 py-1.5 text-slate-300">{[m.firstName, m.lastName].filter(Boolean).join(' ') || '—'}</td>
                            <td className="px-3 py-1.5 text-slate-500">{m.phone || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Adder */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="text-xs font-mono text-emerald-400 tracking-widest">GROUP MEMBER ADDER</div>
              <div>
                <label className="text-xs text-slate-500 block mb-1.5">Target Group (your group to add into)</label>
                <input value={addGroup} onChange={e => setAddGroup(e.target.value)} placeholder="@mygroup"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500/60 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-100 focus:outline-none transition" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1.5">Usernames to add — one per line (auto-filled from scrape)</label>
                <textarea value={addUsernames} onChange={e => setAddUsernames(e.target.value)} rows={6}
                  placeholder={"@username1\n@username2"}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500/60 rounded-xl px-3 py-2.5 text-xs font-mono text-slate-300 focus:outline-none transition resize-none" />
                <div className="text-[10px] text-slate-600 mt-1">{addUsernames.split('\n').filter(l => l.trim()).length} usernames — max 50 per batch</div>
              </div>
              <button onClick={addMembers} disabled={groupLoading || !connected || !addGroup || !addUsernames}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl transition text-sm">
                {groupLoading ? 'Adding...' : '➕ Add Members'}
              </button>

              {addRes && (
                <div className={`rounded-xl p-4 text-sm font-mono border ${addRes.added > 0 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                  ✅ Added: {addRes.added} &nbsp;·&nbsp; ❌ Failed: {addRes.failed}
                  {addRes.errors?.length > 0 && (
                    <div className="mt-2 text-slate-500 text-xs space-y-0.5">
                      {addRes.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── LOG ── */}
        {tab === 'Log' && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <div className="text-xs font-mono text-slate-500 tracking-widest mb-3">LIVE LOG</div>
            <div ref={logRef} className="bg-slate-950 rounded-xl p-3 h-96 overflow-y-auto font-mono text-xs space-y-1">
              {(status?.log || []).length === 0 ? (
                <div className="text-slate-600">No log entries yet...</div>
              ) : (
                status.log.map((entry, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-600 flex-shrink-0">{new Date(entry.ts).toLocaleTimeString()}</span>
                    <span className={entry.msg.includes('✅') ? 'text-emerald-400' : entry.msg.includes('❌') ? 'text-red-400' : entry.msg.includes('⚠️') ? 'text-amber-400' : 'text-slate-300'}>{entry.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
