// Fluent Emoji 3D assets (Microsoft, MIT) — expressive imagery without emoji glyphs.
// Files live in /public/fx, downloaded from github.com/microsoft/fluentui-emoji.
import { fxUrl, type FxName } from '../lib/story/fx'

export type { FxName }

export function Fx({ name, size = 24, className = '', glow = false }: {
  name: FxName; size?: number; className?: string; glow?: boolean
}) {
  return (
    <img
      src={fxUrl(name)} alt="" aria-hidden width={size} height={size}
      className={`inline-block select-none ${glow ? 'drop-shadow-[0_0_18px_rgba(37,211,102,.45)]' : ''} ${className}`}
      draggable={false}
    />
  )
}
