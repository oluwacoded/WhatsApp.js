import React, { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Send, ShieldAlert, KeyRound, Radio } from 'lucide-react';
import { 
  useGetTelegramStatus, 
  useSetupTelegram, 
  useConnectTelegram, 
  useSubmitTelegramCode 
} from '@workspace/api-client-react';
import { toast } from 'sonner';

export default function TelegramPage() {
  const [activeTab, setActiveTab] = useState<'STATUS' | 'SETUP' | 'CONNECT'>('STATUS');
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-[#00ccff]/20 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-muted-foreground hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div className="h-8 w-8 rounded bg-[#00ccff]/10 flex items-center justify-center border border-[#00ccff]/30 text-[#00ccff]">
              <Send size={18} />
            </div>
            <h1 className="text-xl font-bold font-mono tracking-tight text-white">TELEGRAM<span className="text-[#00ccff]">_BOT</span></h1>
          </div>
          <div className="flex gap-1 bg-black/40 p-1 rounded-md border border-white/5 flex-wrap">
            <TabBtn active={activeTab === 'STATUS'} onClick={() => setActiveTab('STATUS')}>STATUS</TabBtn>
            <TabBtn active={activeTab === 'SETUP'} onClick={() => setActiveTab('SETUP')}>SETUP</TabBtn>
            <TabBtn active={activeTab === 'CONNECT'} onClick={() => setActiveTab('CONNECT')}>CONNECT</TabBtn>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 py-8">
        {activeTab === 'STATUS' && <StatusTab />}
        {activeTab === 'SETUP' && <SetupTab />}
        {activeTab === 'CONNECT' && <ConnectTab />}
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
          ? 'bg-[#00ccff]/10 text-[#00ccff] shadow-[inset_0_0_10px_rgba(0,204,255,0.1)]' 
          : 'text-muted-foreground hover:text-white hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function StatusTab() {
  const { data: status, isLoading } = useGetTelegramStatus({ query: { refetchInterval: 5000 } });

  return (
    <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-6 glow-panel">
      <h2 className="text-lg font-mono font-bold mb-6 text-white flex items-center justify-between">
        <span className="flex items-center gap-2"><ShieldAlert size={18} /> SYSTEM STATUS</span>
        {status?.connected && (
          <span className="flex items-center gap-2 text-[#00ccff] text-sm">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ccff] opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-[#00ccff]"></span></span>
            CONNECTED
          </span>
        )}
      </h2>

      {isLoading ? (
        <div className="animate-pulse h-20 bg-white/5 rounded-lg"></div>
      ) : (
        <div className="space-y-6">
          <div className="bg-black/40 p-4 rounded-lg border border-white/5 space-y-4 font-mono text-sm">
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Connection State</span>
              <span className={status?.connected ? "text-[#00ccff]" : "text-red-400"}>
                {status?.connected ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-muted-foreground">API Credentials</span>
              <span className={status?.hasCredentials ? "text-[#00ccff]" : "text-yellow-400"}>
                {status?.hasCredentials ? 'CONFIGURED' : 'MISSING'}
              </span>
            </div>
            {status?.connected && (
              <>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Username</span>
                  <span className="text-white">{status?.username || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Phone Number</span>
                  <span className="text-white">{status?.phone || 'N/A'}</span>
                </div>
              </>
            )}
          </div>
          
          {!status?.connected && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-sm font-mono text-yellow-500/80">
                {!status?.hasCredentials ? "Proceed to SETUP tab to add your API credentials." : "Proceed to CONNECT tab to link your phone number."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SetupTab() {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const setup = useSetupTelegram();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiId || !apiHash) return toast.error("Both fields required");
    
    setup.mutate(
      { data: { apiId, apiHash } },
      { 
        onSuccess: () => {
          toast.success("Credentials saved");
          setApiId('');
          setApiHash('');
        },
        onError: (err: any) => toast.error("Failed to save: " + err.message)
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-6 glow-panel">
      <h2 className="text-lg font-mono font-bold mb-4 text-[#00ccff] flex items-center gap-2">
        <KeyRound size={18} /> API CREDENTIALS
      </h2>
      
      <p className="text-sm font-mono text-muted-foreground mb-6">
        Get your API ID and Hash by creating an application at <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className="text-[#00ccff] hover:underline">my.telegram.org/apps</a>.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block font-mono text-xs text-muted-foreground mb-2">API ID</label>
          <input
            type="text"
            value={apiId}
            onChange={(e) => setApiId(e.target.value)}
            className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#00ccff]/50 focus:ring-1 focus:ring-[#00ccff]/50"
            placeholder="e.g. 1234567"
          />
        </div>
        <div>
          <label className="block font-mono text-xs text-muted-foreground mb-2">API HASH</label>
          <input
            type="text"
            value={apiHash}
            onChange={(e) => setApiHash(e.target.value)}
            className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#00ccff]/50 focus:ring-1 focus:ring-[#00ccff]/50"
            placeholder="e.g. 0123456789abcdef0123456789abcdef"
          />
        </div>
        <button 
          type="submit" 
          disabled={setup.isPending}
          className="w-full py-3 bg-[#00ccff]/20 text-[#00ccff] border border-[#00ccff]/30 rounded-md font-mono hover:bg-[#00ccff]/30 transition-colors disabled:opacity-50 mt-4"
        >
          {setup.isPending ? 'SAVING...' : 'SAVE CREDENTIALS'}
        </button>
      </form>
    </div>
  );
}

function ConnectTab() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'PHONE' | 'CODE' | 'PASSWORD'>('PHONE');
  
  const connect = useConnectTelegram();
  const submitCode = useSubmitTelegramCode();

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    connect.mutate(
      { data: { phone } },
      {
        onSuccess: () => {
          toast.success("Verification code sent");
          setStep('CODE');
        },
        onError: (err: any) => toast.error("Failed to connect: " + err.message)
      }
    );
  };

  const handleCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    submitCode.mutate(
      { data: { code, type: 'phoneCode' } },
      {
        onSuccess: () => {
          toast.success("Verified. Check status tab.");
          setStep('PHONE'); // Reset or move on
        },
        onError: (err: any) => {
          if (err.message?.includes('password') || err.message?.includes('2FA')) {
            toast.info("2FA Password required");
            setStep('PASSWORD');
          } else {
            toast.error("Failed: " + err.message);
          }
        }
      }
    );
  };

  const handlePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    submitCode.mutate(
      { data: { code: password, type: 'password' } },
      {
        onSuccess: () => {
          toast.success("Connected successfully.");
          setStep('PHONE');
        },
        onError: (err: any) => toast.error("Failed: " + err.message)
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-6 glow-panel">
      <h2 className="text-lg font-mono font-bold mb-6 text-[#00ccff] flex items-center gap-2">
        <Radio size={18} /> SESSION AUTHENTICATION
      </h2>

      {step === 'PHONE' && (
        <form onSubmit={handleConnect} className="space-y-4">
          <div>
            <label className="block font-mono text-xs text-muted-foreground mb-2">PHONE NUMBER (INTERNATIONAL FORMAT)</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#00ccff]/50 focus:ring-1 focus:ring-[#00ccff]/50"
              placeholder="+12015550123"
            />
          </div>
          <button type="submit" disabled={connect.isPending} className="w-full py-3 bg-[#00ccff]/20 text-[#00ccff] border border-[#00ccff]/30 rounded-md font-mono hover:bg-[#00ccff]/30 transition-colors disabled:opacity-50">
            {connect.isPending ? 'INITIATING...' : 'CONNECT ACCOUNT'}
          </button>
        </form>
      )}

      {step === 'CODE' && (
        <form onSubmit={handleCode} className="space-y-4">
          <div className="p-3 bg-white/5 border border-white/10 rounded-md mb-4 font-mono text-sm text-muted-foreground">
            Code sent to your Telegram app or SMS.
          </div>
          <div>
            <label className="block font-mono text-xs text-muted-foreground mb-2">VERIFICATION CODE</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white tracking-widest text-center text-lg focus:outline-none focus:border-[#00ccff]/50 focus:ring-1 focus:ring-[#00ccff]/50"
              placeholder="00000"
            />
          </div>
          <button type="submit" disabled={submitCode.isPending} className="w-full py-3 bg-[#00ccff]/20 text-[#00ccff] border border-[#00ccff]/30 rounded-md font-mono hover:bg-[#00ccff]/30 transition-colors disabled:opacity-50">
            {submitCode.isPending ? 'VERIFYING...' : 'SUBMIT CODE'}
          </button>
        </form>
      )}

      {step === 'PASSWORD' && (
        <form onSubmit={handlePassword} className="space-y-4">
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md mb-4 font-mono text-sm text-yellow-500/80">
            Two-Step Verification is enabled on this account.
          </div>
          <div>
            <label className="block font-mono text-xs text-muted-foreground mb-2">CLOUD PASSWORD</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#00ccff]/50 focus:ring-1 focus:ring-[#00ccff]/50"
              placeholder="••••••••"
            />
          </div>
          <button type="submit" disabled={submitCode.isPending} className="w-full py-3 bg-[#00ccff]/20 text-[#00ccff] border border-[#00ccff]/30 rounded-md font-mono hover:bg-[#00ccff]/30 transition-colors disabled:opacity-50">
            {submitCode.isPending ? 'UNLOCKING...' : 'SUBMIT PASSWORD'}
          </button>
        </form>
      )}
    </div>
  );
}
