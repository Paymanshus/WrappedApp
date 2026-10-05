import { useSyncExternalStore } from 'react'
import { forgetKeys, loadConfig, loadKeys, saveConfig, saveKeys, type AskConfig, type ProviderId } from './providers'

// Ask settings shared by the Ask panel and its settings sheet (one copy, persisted on change).

let snap = { config: loadConfig(), keys: loadKeys() }
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

export function useAskSettings() {
  return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb) }, () => snap)
}

export function updateConfig(patch: Partial<AskConfig>) {
  const config = { ...snap.config, ...patch }
  snap = { ...snap, config }
  saveConfig(config)
  if ('remember' in patch) saveKeys(snap.keys, config.remember)
  emit()
}

export function setKey(provider: ProviderId, key: string) {
  const keys = { ...snap.keys, [provider]: key.trim() || undefined }
  snap = { ...snap, keys }
  saveKeys(keys, snap.config.remember)
  emit()
}

export function clearKeys() {
  forgetKeys()
  snap = { ...snap, keys: {} }
  emit()
}
