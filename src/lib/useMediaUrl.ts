import { useEffect, useState } from 'react'
import { getMediaBlob } from './opfs'

/** Object URL for a stored media file (OPFS or IndexedDB), revoked on unmount. */
export function useMediaUrl(mediaKey?: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!mediaKey) return
    let obj: string | null = null
    let alive = true
    getMediaBlob(mediaKey).then(blob => {
      if (blob && alive) { obj = URL.createObjectURL(blob); setUrl(obj) }
    })
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj) }
  }, [mediaKey])
  return url
}
