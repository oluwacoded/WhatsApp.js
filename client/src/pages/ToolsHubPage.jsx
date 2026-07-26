
const TOOLS = [
  {
    id: 'geolocation',
    name: 'Geolocation Tool',
    subtitle: 'NETRYX-ASTRA-V2',
    desc: 'IP & domain geolocation — coordinates, ISP, threat intel, ASN lookup.',
    icon: '🌍',
    color: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/30',
    badge: 'LIVE',
    badgeColor: 'bg-emerald-500/20 text-emerald-400',
    path: '/tools/geolocation',
  },
  {
    id: 'aimap',
    name: 'AI Attack Surface',
    subtitle: 'AIMAP — BishopFox',
    desc: 'Discover exposed AI endpoints — Ollama, vLLM, MCP servers, LangServe, AutoGen.',
    icon: '🤖',
    color: 'from-blue-500/20 to-indigo-500/10 border-blue-500/30',
    badge: 'LIVE',
    badgeColor: 'bg-blue-500/20 text-blue-400',
    path: '/tools/aimap',
  },
  {
    id: 'voidaccess',
    name: 'VoidAccess OSINT',
    subtitle: 'KATRIELMOSES/VOIDACCESS',
    desc: 'Dark-web & open-source intelligence — threat actors, IOCs, breach data, CVE lookups.',
    icon: '🕳️',
    color: 'from-purple-500/20 to-violet-500/10 border-purple-500/30',
    badge: 'LIVE',
    badgeColor: 'bg-purple-500/20 text-purple-400',
    path: '/tools/voidaccess',
  },
  {
    id: 'metatron',
    name: 'Metatron Pentest',
    subtitle: 'SOORYATHEJAS/METATRON',
    desc: 'AI-powered recon assistant — DNS, HTTP headers, port hints, Groq-AI vulnerability analysis.',
    icon: '🔱',
    color: 'from-orange-500/20 to-red-500/10 border-orange-500/30',
    badge: 'LIVE',
    badgeColor: 'bg-orange-500/20 text-orange-400',
    path: '/tools/metatron',
  },
  {
    id: 'nuclei',
    name: 'Nuclei Scanner',
    subtitle: 'PROJECTDISCOVERY/NUCLEI',
    desc: 'Template-based vulnerability scanner — CVEs, misconfigs, exposed panels, tech detection.',
    icon: '☢️',
    color: 'from-red-500/20 to-rose-500/10 border-red-500/30',
    badge: 'BINARY',
    badgeColor: 'bg-red-500/20 text-red-400',
    path: '/tools/nuclei',
  },
  {
    id: 'garak',
    name: 'Garak LLM Probe',
    subtitle: 'NVIDIA/GARAK',
    desc: 'Red-team any LLM API — jailbreaks, prompt injection, data leakage, hallucination detection.',
    icon: '👁️',
    color: 'from-cyan-500/20 to-sky-500/10 border-cyan-500/30',
    badge: 'LIVE',
    badgeColor: 'bg-cyan-500/20 text-cyan-400',
    path: '/tools/garak',
  },
];

const BOTS = [
  { name: 'WhatsApp Bot', icon: '💬', path: '/whatsapp', color: 'from-green-500/20 to-emerald-500/10 border-green-500/30' },
  { name: 'Signal Bot', icon: '🔒', path: '/signal', color: 'from-blue-500/20 to-cyan-500/10 border-blue-500/30' },
  { name: 'Telegram Bot', icon: '✈️', path: '/telegram', color: 'from-sky-500/20 to-blue-500/10 border-sky-500/30' },
  { name: 'Voice Changer', icon: '🎙️', path: '/voice-changer', color: 'from-violet-500/20 to-purple-500/10 border-violet-500/30' },
];

export default function ToolsHubPage() {
  

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/50 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => window.location.href = '/'} className="text-slate-400 hover:text-slate-100 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">← Dashboard</button>
          <div className="w-px h-5 bg-slate-700" />
          <span className="font-bold text-slate-100 tracking-wide">MFG TOOLKIT</span>
          <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-mono">6 TOOLS</span>
        </div>
        <div className="text-xs text-slate-500 font-mono">AUTHORIZED USE ONLY</div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-full font-mono mb-4">
            <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
            SECURITY RESEARCH PLATFORM
          </div>
          <h1 className="text-4xl font-black mb-3 bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
            MFG CYBER TOOLKIT
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto text-sm">
            6 integrated security tools — geolocation, OSINT, AI surface mapping, vulnerability scanning, LLM red-teaming & pentest assistance.
          </p>
        </div>

        {/* Tools Grid */}
        <div className="mb-10">
          <h2 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-4">Security Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                onClick={() => navigate(tool.path)}
                className={`bg-gradient-to-br ${tool.color} border rounded-xl p-5 text-left hover:scale-[1.02] transition-all duration-200 group`}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-3xl">{tool.icon}</span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded border ${tool.badgeColor} border-current/30`}>{tool.badge}</span>
                </div>
                <div className="font-bold text-slate-100 mb-0.5 group-hover:text-white transition">{tool.name}</div>
                <div className="text-xs font-mono text-slate-500 mb-2">{tool.subtitle}</div>
                <div className="text-sm text-slate-400 leading-relaxed">{tool.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Bot Pages */}
        <div>
          <h2 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-4">Bot Platforms</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {BOTS.map((bot) => (
              <button
                key={bot.path}
                onClick={() => navigate(bot.path)}
                className={`bg-gradient-to-br ${bot.color} border rounded-xl p-4 text-left hover:scale-[1.02] transition-all duration-200`}
              >
                <div className="text-2xl mb-2">{bot.icon}</div>
                <div className="font-semibold text-slate-100 text-sm">{bot.name}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl text-xs text-amber-400/80 font-mono">
          ⚠️ These tools are for authorized security research and penetration testing only. Only use against systems you own or have explicit written permission to test.
        </div>
      </div>
    </div>
  );
}
