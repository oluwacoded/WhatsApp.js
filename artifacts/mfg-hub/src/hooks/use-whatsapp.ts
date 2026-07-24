import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

// We manage WhatsApp config entirely locally in this custom hook 
// because it can connect to any arbitrary backend URL.
export function useWhatsAppUrl() {
  const [url, setUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('wa_backend_url') || '';
    }
    return '';
  });
  
  const saveUrl = (newUrl: string) => {
    // Strip trailing slash
    const cleanUrl = newUrl.replace(/\/$/, '');
    localStorage.setItem('wa_backend_url', cleanUrl);
    setUrl(cleanUrl);
  };

  return { url, saveUrl };
}

export function useWhatsAppStatus(url: string) {
  return useQuery({
    queryKey: ['wa_status', url],
    queryFn: async () => {
      if (!url) return null;
      const res = await fetch(`${url}/api/status`);
      if (!res.ok) throw new Error('Failed to fetch status');
      return res.json();
    },
    enabled: !!url,
    refetchInterval: 4000,
  });
}

export function useWhatsAppQR(url: string) {
  return useQuery({
    queryKey: ['wa_qr', url],
    queryFn: async () => {
      if (!url) return null;
      const res = await fetch(`${url}/api/qr`);
      if (!res.ok) throw new Error('Failed to fetch QR');
      return res.json();
    },
    enabled: !!url,
    refetchInterval: 4000,
  });
}

export function useWhatsAppSettings(url: string) {
  return useQuery({
    queryKey: ['wa_settings', url],
    queryFn: async () => {
      if (!url) return null;
      const res = await fetch(`${url}/api/settings`);
      if (!res.ok) throw new Error('Failed to fetch settings');
      return res.json();
    },
    enabled: !!url,
  });
}
