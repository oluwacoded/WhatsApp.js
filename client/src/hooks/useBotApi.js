import { useState, useEffect, useCallback, useRef } from 'react'

function baseUrl(bot) {
  if (!bot || bot.isLocal) return ''
  return (bot.url || '').replace(/\/$/, '')
}

export function useBotApi(bot) {
  const base = baseUrl(bot)

  const request = useCallback(async (method, path, body) => {
    const opts = { method, headers: {} }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(`${base}${path}`, opts)
    const text = await res.text()
    let data = null
    if (text) {
      try { data = JSON.parse(text) } catch { data = text }
    }
    if (!res.ok) {
      const msg = (data && data.error) || (typeof data === 'string' && data) || `Request failed (${res.status})`
      throw new Error(msg)
    }
    return data
  }, [base])

  const get = useCallback((path) => request('GET', path), [request])
  const post = useCallback((path, body = {}) => request('POST', path, body), [request])
  const del = useCallback((path) => request('DELETE', path), [request])

  return { get, post, del }
}

export function useBotStatus(bot, { pollMs = 5000 } = {}) {
  const { get } = useBotApi(bot)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const data = await get('/api/status')
      if (!mounted.current) return
      setStatus(data)
      setError(null)
    } catch (e) {
      if (!mounted.current) return
      setError(e)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [get])

  useEffect(() => {
    mounted.current = true
    refresh()
    const id = setInterval(refresh, pollMs)
    return () => { mounted.current = false; clearInterval(id) }
  }, [refresh, pollMs])

  return { status, loading, error, refresh }
}
