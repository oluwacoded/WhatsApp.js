import React, { useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, MessageSquare, Activity, UserPlus, Link2 } from 'lucide-react';
import { 
  useGetSignalStatus, 
  useRegisterSignal, 
  useVerifySignal, 
  useLinkSignalDevice, 
  useGetSignalLinkStatus 
} from '@workspace/api-client-react';
import { toast } from 'sonner';

export default function SignalPage() {
  const [activeTab, setActiveTab] = useState<'STATUS' | 'REGISTER' | 'LINK'>('STATUS');
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-[#a855f7]/20 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-muted-foreground hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div className="h-8 w-8 rounded bg-[#a855f7]/10 flex items-center justify-center border border-[#a855f7]/30 text-[#a855f7]">
              <MessageSquare size={18} />
            </div>
            <h1 className="text-xl font-bold font-mono tracking-tight text-white">SIGNAL<span className="text-[#a855f7]">_BOT</span></h1>
          </div>
          <div className="flex gap-1 bg-black/40 p-1 rounded-md border border-white/5 flex-wrap">
            <TabBtn active={activeTab === 'STATUS'} onClick={() => setActiveTab('STATUS')}>STATUS</TabBtn>
            <TabBtn active={activeTab === 'REGISTER'} onClick={() => setActiveTab('REGISTER')}>REGISTER</TabBtn>
            <TabBtn active={activeTab === 'LINK'} onClick={() => setActiveTab('LINK')}>LINK</TabBtn>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full p-6 py-8">
        {activeTab === 'STATUS' && <StatusTab />}
        {activeTab === 'REGISTER' && <RegisterTab />}
        {activeTab === 'LINK' && <LinkTab />}
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
          ? 'bg-[#a855f7]/10 text-[#a855f7] shadow-[inset_0_0_10px_rgba(168,85,247,0.1)]' 
          : 'text-muted-foreground hover:text-white hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function StatusTab() {
  const { data: status, isLoading } = useGetSignalStatus({ query: { refetchInterval: 3000 } });

  const getPhaseColor = (phase?: string) => {
    switch(phase) {
      case 'ready': return 'text-[#00ff80]';
      case 'error': return 'text-red-500';
      case 'starting':
      case 'reconnecting': return 'text-yellow-500';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-6 glow-purple">
      <h2 className="text-lg font-mono font-bold mb-6 text-white flex items-center justify-between">
        <span className="flex items-center gap-2"><Activity size={18} /> SERVICE TELEMETRY</span>
        {status?.ready && (
          <span className="flex items-center gap-2 text-[#00ff80] text-sm bg-[#00ff80]/10 px-3 py-1 rounded-full border border-[#00ff80]/20">
            ONLINE
          </span>
        )}
        {!status?.ready && status?.phase && (
          <span className="flex items-center gap-2 text-red-500 text-sm bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20">
            OFFLINE
          </span>
        )}
      </h2>

      {isLoading ? (
        <div className="animate-pulse h-20 bg-white/5 rounded-lg"></div>
      ) : (
        <div className="space-y-6">
          <div className="bg-black/40 p-4 rounded-lg border border-white/5 space-y-4 font-mono text-sm">
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Current Phase</span>
              <span className={`uppercase font-bold ${getPhaseColor(status?.phase)}`}>
                {status?.phase || 'UNKNOWN'}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Registration Status</span>
              <span className={status?.registered ? "text-[#a855f7]" : "text-yellow-400"}>
                {status?.registered ? 'REGISTERED' : 'UNREGISTERED'}
              </span>
            </div>
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Process Restarts</span>
              <span className="text-white">{status?.restarts || 0}</span>
            </div>
            <div className="flex justify-between items-center border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Linked Number</span>
              <span className="text-white">{status?.number || 'N/A'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Client Version</span>
              <span className="text-white">{status?.version || 'N/A'}</span>
            </div>
          </div>
          
          {status?.error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm font-mono text-red-400">ERROR: {status.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RegisterTab() {
  const [number, setNumber] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [step, setStep] = useState<'FORM' | 'CODE'>('FORM');
  const [code, setCode] = useState('');

  const register = useRegisterSignal();
  const verify = useVerifySignal();

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!number) return;
    register.mutate(
      { data: { number, captcha: captcha || undefined } },
      {
        onSuccess: () => {
          toast.success("Registration initiated, SMS sent");
          setStep('CODE');
        },
        onError: (err: any) => toast.error("Registration failed: " + err.message)
      }
    );
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    verify.mutate(
      { data: { number, code } },
      {
        onSuccess: () => {
          toast.success("Number verified successfully");
          setStep('FORM');
        },
        onError: (err: any) => toast.error("Verification failed: " + err.message)
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-6 glow-purple">
      <h2 className="text-lg font-mono font-bold mb-6 text-[#a855f7] flex items-center gap-2">
        <UserPlus size={18} /> NEW DEVICE REGISTRATION
      </h2>

      {step === 'FORM' && (
        <form onSubmit={handleRegister} className="space-y-5">
          <div>
            <label className="block font-mono text-xs text-muted-foreground mb-2">PHONE NUMBER</label>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#a855f7]/50 focus:ring-1 focus:ring-[#a855f7]/50"
              placeholder="+12015550123"
            />
          </div>
          <div>
            <label className="block font-mono text-xs text-muted-foreground mb-2 flex justify-between">
              <span>CAPTCHA TOKEN</span>
              <span className="text-white/30">(Optional)</span>
            </label>
            <textarea
              value={captcha}
              onChange={(e) => setCaptcha(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#a855f7]/50 focus:ring-1 focus:ring-[#a855f7]/50 min-h-[80px]"
              placeholder="signal-captcha://..."
            />
            <p className="text-xs text-muted-foreground font-mono mt-2">Only needed if Signal requires it due to rate limiting.</p>
          </div>
          <button type="submit" disabled={register.isPending} className="w-full py-3 bg-[#a855f7]/20 text-[#a855f7] border border-[#a855f7]/30 rounded-md font-mono hover:bg-[#a855f7]/30 transition-colors disabled:opacity-50">
            {register.isPending ? 'REQUESTING SMS...' : 'REGISTER NUMBER'}
          </button>
        </form>
      )}

      {step === 'CODE' && (
        <form onSubmit={handleVerify} className="space-y-5">
          <div className="p-3 bg-white/5 border border-white/10 rounded-md mb-4 font-mono text-sm text-muted-foreground text-center">
            SMS code sent to <span className="text-white font-bold">{number}</span>
          </div>
          <div>
            <label className="block font-mono text-xs text-muted-foreground mb-2">VERIFICATION CODE</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-md px-4 py-3 font-mono text-xl text-white text-center tracking-[0.5em] focus:outline-none focus:border-[#a855f7]/50 focus:ring-1 focus:ring-[#a855f7]/50"
              placeholder="000-000"
            />
          </div>
          <button type="submit" disabled={verify.isPending} className="w-full py-3 bg-[#a855f7]/20 text-[#a855f7] border border-[#a855f7]/30 rounded-md font-mono hover:bg-[#a855f7]/30 transition-colors disabled:opacity-50">
            {verify.isPending ? 'VERIFYING...' : 'VERIFY & FINISH'}
          </button>
          <button type="button" onClick={() => setStep('FORM')} className="w-full py-2 text-muted-foreground hover:text-white font-mono text-sm">
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

function LinkTab() {
  const linkDevice = useLinkSignalDevice();
  const { data: linkStatus } = useGetSignalLinkStatus({ query: { refetchInterval: 2000 } });

  const handleLink = () => {
    linkDevice.mutate(undefined, {
      onSuccess: () => toast.success("Linking process started"),
      onError: (err: any) => toast.error("Link failed: " + err.message)
    });
  };

  const isActive = linkStatus?.state && linkStatus.state !== 'idle' && linkStatus.state !== 'linked' && linkStatus.state !== 'error';

  return (
    <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-6 glow-purple text-center">
      <div className="w-16 h-16 bg-[#a855f7]/10 rounded-full flex items-center justify-center border border-[#a855f7]/30 text-[#a855f7] mx-auto mb-6">
        <Link2 size={32} />
      </div>
      
      <h2 className="text-xl font-mono font-bold mb-2 text-white">LINK EXISTING ACCOUNT</h2>
      <p className="text-sm font-mono text-muted-foreground mb-8 max-w-md mx-auto">
        Run this bot as a secondary linked device to your primary Signal app on your phone.
      </p>

      {!isActive && (
        <button 
          onClick={handleLink}
          disabled={linkDevice.isPending}
          className="px-8 py-3 bg-[#a855f7]/20 text-[#a855f7] border border-[#a855f7]/30 rounded-md font-mono hover:bg-[#a855f7]/30 transition-colors disabled:opacity-50"
        >
          {linkDevice.isPending ? 'INITIALIZING...' : 'START LINKING PROCESS'}
        </button>
      )}

      {isActive && (
        <div className="mt-6 space-y-6">
          <div className="inline-flex items-center gap-3 px-4 py-2 bg-black/40 border border-white/10 rounded-full font-mono text-sm">
            <div className="w-3 h-3 border-2 border-[#a855f7] border-t-transparent rounded-full animate-spin" />
            <span className="text-[#a855f7] uppercase tracking-wider">{linkStatus?.state}</span>
          </div>

          {linkStatus?.state === 'waiting_scan' && linkStatus.uri && (
            <div className="bg-black/50 border border-[#a855f7]/30 rounded-lg p-6 max-w-lg mx-auto">
              <p className="text-white font-mono mb-4">Scan this URI with your Signal app (Settings → Linked Devices → Link a Device) or generate a QR code from it.</p>
              <div className="bg-white/5 p-4 rounded-md break-all font-mono text-xs text-[#a855f7] text-left">
                {linkStatus.uri}
              </div>
            </div>
          )}
        </div>
      )}

      {linkStatus?.state === 'linked' && (
        <div className="mt-8 p-4 bg-[#00ff80]/10 border border-[#00ff80]/20 text-[#00ff80] rounded-lg font-mono">
          Device linked successfully! Check Status tab.
        </div>
      )}
      
      {linkStatus?.state === 'error' && (
        <div className="mt-8 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg font-mono">
          Error: {linkStatus.error || "Linking failed"}
        </div>
      )}
    </div>
  );
}
