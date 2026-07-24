import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import HubHome from '@/pages/hub';
import WhatsAppPage from '@/pages/whatsapp';
import TelegramPage from '@/pages/telegram';
import SignalPage from '@/pages/signal';
import VoiceChangerPage from '@/pages/voice-changer';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="dark min-h-[100dvh] bg-background text-foreground font-sans selection:bg-primary selection:text-black">
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Switch>
            <Route path="/" component={HubHome} />
            <Route path="/whatsapp" component={WhatsAppPage} />
            <Route path="/telegram" component={TelegramPage} />
            <Route path="/signal" component={SignalPage} />
            <Route path="/voice-changer" component={VoiceChangerPage} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </div>
    </QueryClientProvider>
  );
}

export default App;
