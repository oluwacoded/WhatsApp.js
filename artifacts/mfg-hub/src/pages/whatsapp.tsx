import React, { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, MessageCircle, Settings, Terminal, ShieldAlert, KeyRound, Smartphone, LogOut } from 'lucide-react';
import { useWhatsAppUrl, useWhatsAppStatus, useWhatsAppQR, useWhatsAppSettings } from '@/hooks/use-whatsapp';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export default function WhatsAppPage() {
  const [activeTab, setActiveTab] = useState<'CONNECTION' | 'SETTINGS' | 'COMMANDS'>('CONNECTION');
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-[#00ff80]/20 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-muted-foreground hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div className="h-8 w-8 rounded bg-[#00ff80]/10 flex items-center justify-center border border-[#00ff80]/30 text-[#00ff80]">
              <MessageCircle size={18} />
            </div>
            <h1 className="text-xl font-bold font-mono tracking-tight text-white">WHATSAPP<span className="text-[#00ff80]">_BOT</span></h1>
          </div>
          <div className="flex gap-1 bg-black/40 p-1 rounded-md border border-white/5">
            <TabBtn active={activeTab === 'CONNECTION'} onClick={() => setActiveTab('CONNECTION')}>CONNECTION</TabBtn>
            <TabBtn active={activeTab === 'SETTINGS'} onClick={() => setActiveTab('SETTINGS')}>SETTINGS</TabBtn>
            <TabBtn active={activeTab === 'COMMANDS'} onClick={() => setActiveTab('COMMANDS')}>COMMANDS</TabBtn>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 py-8">
        {activeTab === 'CONNECTION' && <ConnectionTab />}
        {activeTab === 'SETTINGS' && <SettingsTab />}
        {activeTab === 'COMMANDS' && <CommandsTab />}
      </main>
    </div>
  );
}

function TabBtn({ active, children, onClick }: { active: boolean, children: React.ReactNode, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 font-mono text-sm rounded-sm transition-all ${
        active 
          ? 'bg-[#00ff80]/10 text-[#00ff80] shadow-[inset_0_0_10px_rgba(0,255,128,0.1)]' 
          : 'text-muted-foreground hover:text-white hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function ConnectionTab() {
  const { url, saveUrl } = useWhatsAppUrl();
  const [inputUrl, setInputUrl] = useState(url);
  const [phone, setPhone] = useState('');
  
  const { data: status, isLoading: statusLoading } = useWhatsAppStatus(url);
  const { data: qrData } = useWhatsAppQR(url);
  const queryClient = useQueryClient();

  const handleSaveUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl) return;
    saveUrl(inputUrl);
    toast.success('Backend URL saved');
  };

  const handleLogout = async () => {
    if (!url) return;
    try {
      await fetch(`${url}/api/logout`, { method: 'POST' });
      toast.success('Logout initiated');
      queryClient.invalidateQueries({ queryKey: ['wa_status', url] });
    } catch (e: any) {
      toast.error('Logout failed: ' + e.message);
    }
  };

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !phone) return;
    try {
      const res = await fetch(`${url}/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (data.code) {
        toast.success(`Pairing code: ${data.code}`);
        alert(`Your pairing code is: ${data.code}\nEnter this in WhatsApp.`);
      }
    } catch (e: any) {
      toast.error('Pairing failed: ' + e.message);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="bg-card border border-border rounded-xl p-6 glow-green relative overflow-hidden">
        <h2 className="text-lg font-mono font-bold mb-4 text-[#00ff80] flex items-center gap-2">
          <Terminal size={18} /> BACKEND CONFIG
        </h2>
        
        <form onSubmit={handleSaveUrl} className="flex gap-2">
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="http://localhost:3000"
            className="flex-1 bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#00ff80]/50 focus:ring-1 focus:ring-[#00ff80]/50"
          />
          <button type="submit" className="px-6 py-2 bg-[#00ff80]/20 text-[#00ff80] border border-[#00ff80]/30 rounded-md font-mono hover:bg-[#00ff80]/30 transition-colors">
            CONNECT
          </button>
        </form>
        {!url && <p className="text-muted-foreground text-sm mt-3 font-mono">Enter your bot backend URL to connect.</p>}
      </div>

      {url && (
        <div className="bg-card border border-border rounded-xl p-6 glow-green">
          <h2 className="text-lg font-mono font-bold mb-6 text-white flex items-center justify-between">
            <span className="flex items-center gap-2"><ShieldAlert size={18} /> SESSION STATUS</span>
            {status?.connected && (
              <span className="flex items-center gap-2 text-[#00ff80] text-sm">
                <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ff80] opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-[#00ff80]"></span></span>
                CONNECTED
              </span>
            )}
          </h2>

          {statusLoading ? (
            <div className="animate-pulse flex space-x-4">
              <div className="h-4 bg-white/10 rounded w-3/4"></div>
            </div>
          ) : status?.connected ? (
            <div className="space-y-6">
              <div className="bg-black/40 p-4 rounded-lg border border-white/5 space-y-2 font-mono text-sm text-muted-foreground">
                <p>Uptime: <span className="text-white">{status.uptime || 0}s</span></p>
                <p>Messages Handled: <span className="text-white">{status.messageCount || 0}</span></p>
                <p>Active Chats: <span className="text-white">{status.chatCount || 0}</span></p>
                <p>AI State: <span className={status.aiEnabled ? 'text-green-400' : 'text-red-400'}>{status.aiEnabled ? 'ENABLED' : 'DISABLED'}</span></p>
              </div>
              <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 border border-red-500/30 rounded-md font-mono text-sm hover:bg-red-500/20 transition-colors">
                <LogOut size={16} /> LOGOUT SESSION
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-mono text-muted-foreground mb-4 flex items-center gap-2"><Smartphone size={16} /> VIA QR CODE</h3>
                {qrData?.qr ? (
                  <div className="bg-white p-4 rounded-xl w-48 h-48 flex items-center justify-center">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrData.qr)}`} alt="WhatsApp QR" />
                  </div>
                ) : status?.hasQr ? (
                  <div className="w-48 h-48 bg-black/50 rounded-xl border border-white/5 flex items-center justify-center flex-col gap-3">
                    <div className="w-6 h-6 border-2 border-[#00ff80] border-t-transparent rounded-full animate-spin" />
                    <span className="font-mono text-xs text-muted-foreground">LOADING QR</span>
                  </div>
                ) : (
                  <p className="text-sm font-mono text-muted-foreground">Waiting for QR...</p>
                )}
              </div>
              
              <div>
                <h3 className="text-sm font-mono text-muted-foreground mb-4 flex items-center gap-2"><KeyRound size={16} /> VIA PHONE NUMBER</h3>
                <form onSubmit={handlePair} className="space-y-4">
                  <div>
                    <label className="block font-mono text-xs text-muted-foreground mb-2">PHONE NUMBER (WITH COUNTRY CODE)</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 12015550123"
                      className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#00ff80]/50"
                    />
                  </div>
                  <button type="submit" className="w-full py-2 bg-white/5 text-white border border-white/10 rounded-md font-mono text-sm hover:bg-white/10 transition-colors">
                    GET PAIRING CODE
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const { url } = useWhatsAppUrl();
  const { data: settings } = useWhatsAppSettings(url);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDelay, setAiDelay] = useState(0);
  const [aiTyping, setAiTyping] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  React.useEffect(() => {
    if (settings && !isInitialized) {
      setAiEnabled(settings.aiEnabled || false);
      setAiDelay(settings.aiDelay || 0);
      setAiTyping(settings.aiTyping || false);
      setIsInitialized(true);
    }
  }, [settings, isInitialized]);

  const handleSave = async () => {
    if (!url) return;
    try {
      const res = await fetch(`${url}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiEnabled, aiDelay, aiTyping })
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Settings updated');
    } catch (e: any) {
      toast.error('Save failed: ' + e.message);
    }
  };

  if (!url) return <div className="text-center font-mono text-muted-foreground">Connect backend first.</div>;

  return (
    <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-6 glow-green space-y-8">
      <h2 className="text-lg font-mono font-bold text-white flex items-center gap-2">
        <Settings size={18} /> BOT BEHAVIOR
      </h2>

      <div className="space-y-6">
        <div className="flex items-center justify-between p-4 bg-black/40 rounded-lg border border-white/5">
          <div>
            <h3 className="font-mono text-sm text-white">AI Responses</h3>
            <p className="font-mono text-xs text-muted-foreground mt-1">Enable auto-reply for incoming messages.</p>
          </div>
          <button 
            onClick={() => setAiEnabled(!aiEnabled)}
            className={`w-12 h-6 rounded-full transition-colors relative ${aiEnabled ? 'bg-[#00ff80]' : 'bg-white/10'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-black absolute top-1 transition-transform ${aiEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-black/40 rounded-lg border border-white/5">
          <div>
            <h3 className="font-mono text-sm text-white">Simulate Typing</h3>
            <p className="font-mono text-xs text-muted-foreground mt-1">Show "typing..." status before sending.</p>
          </div>
          <button 
            onClick={() => setAiTyping(!aiTyping)}
            className={`w-12 h-6 rounded-full transition-colors relative ${aiTyping ? 'bg-[#00ff80]' : 'bg-white/10'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-black absolute top-1 transition-transform ${aiTyping ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        <div className="p-4 bg-black/40 rounded-lg border border-white/5 space-y-4">
          <div>
            <h3 className="font-mono text-sm text-white">Response Delay: {aiDelay}s</h3>
            <p className="font-mono text-xs text-muted-foreground mt-1">Artificial delay before responding.</p>
          </div>
          <input 
            type="range" 
            min="0" max="10" step="1" 
            value={aiDelay} 
            onChange={(e) => setAiDelay(parseInt(e.target.value))}
            className="w-full accent-[#00ff80]"
          />
        </div>
      </div>

      <button onClick={handleSave} className="w-full py-3 bg-[#00ff80]/20 text-[#00ff80] border border-[#00ff80]/30 rounded-md font-mono hover:bg-[#00ff80]/30 transition-colors">
        SAVE SETTINGS
      </button>
    </div>
  );
}

function CommandsTab() {
  const [search, setSearch] = useState('');
  
  const COMMANDS = [
    { cmd: '.ai on/off', desc: 'Toggle AI auto-replies' },
    { cmd: '.ai mode', desc: 'Change AI personality/mode' },
    { cmd: '.ai prompt <text>', desc: 'Set custom system prompt' },
    { cmd: '.broadcast all <msg>', desc: 'Send message to all contacts' },
    { cmd: '.broadcast group <msg>', desc: 'Send message to all groups' },
    { cmd: '.bot status', desc: 'Show uptime and stats' },
    { cmd: '.bot ping', desc: 'Check bot latency' },
    { cmd: '.vv <text>', desc: 'View once media handler' },
    { cmd: '.send <number> <msg>', desc: 'Send message to specific number' },
    { cmd: '.stats', desc: 'Detailed bot statistics' },
    { cmd: '.flip', desc: 'Flip a coin' },
    { cmd: '.roll', desc: 'Roll a dice' },
    { cmd: '.ping', desc: 'Simple ping/pong test' },
    { cmd: '.menu', desc: 'Show available commands' },
    { cmd: '.weather <city>', desc: 'Get current weather' },
    { cmd: '.joke', desc: 'Tell a random joke' },
    { cmd: '.fact', desc: 'Random interesting fact' },
    { cmd: '.quote', desc: 'Inspirational quote' },
    { cmd: '.truth', desc: 'Truth or dare (Truth)' },
    { cmd: '.dare', desc: 'Truth or dare (Dare)' },
    { cmd: '.8ball <q>', desc: 'Magic 8-ball answers' },
    { cmd: '.coin balance', desc: 'Check virtual coin balance' },
    { cmd: '.ticket', desc: 'Open a support ticket' }
  ];

  const filtered = COMMANDS.filter(c => c.cmd.toLowerCase().includes(search.toLowerCase()) || c.desc.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <input 
        type="text" 
        placeholder="Search commands..." 
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-card border border-border rounded-xl px-4 py-3 font-mono text-sm text-white focus:outline-none focus:border-[#00ff80]/50 focus:ring-1 focus:ring-[#00ff80]/50 glow-green"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(c => (
          <div key={c.cmd} className="bg-card border border-border rounded-lg p-4 flex flex-col hover:border-[#00ff80]/30 transition-colors">
            <code className="text-[#00ff80] font-mono text-sm font-bold mb-2 block">{c.cmd}</code>
            <p className="text-muted-foreground text-sm font-sans">{c.desc}</p>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground font-mono col-span-2 text-center py-8">No commands found.</p>}
      </div>
    </div>
  );
}
