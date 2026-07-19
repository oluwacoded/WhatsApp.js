import { useState, useEffect, useCallback } from 'react'

function getApiBase(bot) {
  return bot.isLocal ? '' : bot.url
}

async function tryEndpoints(baseUrl, paths) {
  for (const p of paths) {
    try {
      const res = await fetch(`${baseUrl}${p}`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) return { res, path: p }
    } catch (e) {}
  }
  return null
}

export function useBotStatus(bot) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Debounce: count how many consecutive polls showed disconnected before switching
  const disconnectCount = useState({ n: 0 })[0]

  const baseUrl = getApiBase(bot)

  const fetch_ = useCallback(async () => {
    try {
      const result = await tryEndpoints(baseUrl, ['/api/status', '/status'])
      if (!result) throw new Error('Unreachable')
      const data = await result.res.json()
      const next = {
        connected: data.connected,
        hasQr: data.hasQr,
        uptime: data.uptime ?? null,
        messageCount: data.messageCount ?? null,
        chatCount: data.chatCount ?? null,
        aiEnabled: data.aiEnabled ?? null,
        _apiStyle: result.path.startsWith('/api') ? 'new' : 'old'
      }
      // Debounce disconnected state — only show "disconnected" after 3 consecutive
      // polls confirm it, so brief Baileys reconnect flicker doesn't show in UI
      if (!next.connected && !next.hasQr) {
        disconnectCount.n++
        if (disconnectCount.n < 3) return // keep previous status shown
      } else {
        disconnectCount.n = 0
      }
      setStatus(next)
      setError(null)
    } catch (e) {
      disconnectCount.n++
      if (disconnectCount.n >= 3) {
        setError(e.message)
        setStatus(null)
      }
    } finally {
      setLoading(false)
    }
  }, [baseUrl, disconnectCount])

  useEffect(() => {
    fetch_()
    const interval = setInterval(fetch_, 4000)
    return () => clearInterval(interval)
  }, [fetch_])

  return { status, loading, error, refresh: fetch_ }
}

export function useBotApi(bot) {
  const baseUrl = getApiBase(bot)
  // Detect API style — default to new (/api prefix), fall back to old on first real call
  const [apiPrefix, setApiPrefix] = useState(bot.isLocal ? '/api' : null)

  async function resolvePrefix() {
    if (apiPrefix) return apiPrefix
    const result = await tryEndpoints(baseUrl, ['/api/status', '/status'])
    const p = result?.path?.startsWith('/api') ? '/api' : ''
    setApiPrefix(p)
    return p
  }

  async function readError(res) {
    try { const d = await res.json(); return d.error || d.message || `HTTP ${res.status}` } catch { return `HTTP ${res.status}` }
  }

  const get = async (path) => {
    const prefix = await resolvePrefix()
    const cleanPath = path.startsWith('/api/') ? path.replace('/api', '') : path
    const url = `${baseUrl}${prefix}${cleanPath}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(await readError(res))
    return res.json()
  }

  const post = async (path, body, { timeoutMs = 8000 } = {}) => {
    const prefix = await resolvePrefix()
    const cleanPath = path.startsWith('/api/') ? path.replace('/api', '') : path
    const url = `${baseUrl}${prefix}${cleanPath}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) throw new Error(await readError(res))
    return res.json()
  }

  const del = async (path) => {
    const prefix = await resolvePrefix()
    const cleanPath = path.startsWith('/api/') ? path.replace('/api', '') : path
    const url = `${baseUrl}${prefix}${cleanPath}`
    const res = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(await readError(res))
    return res.json()
  }

  return { get, post, del }
}
