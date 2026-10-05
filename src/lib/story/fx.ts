// Fluent Emoji 3D assets (Microsoft, MIT) shipped in /public/fx — the expression tier.
export const FX_NAMES = [
  'fire', 'cactus', 'collision', 'camera', 'trophy', 'owl', 'sun', 'tv', 'eyes', 'joy',
  'scale', 'biceps', 'speech', 'party', 'night',
  'memo', 'zap', 'mic', 'ghost', 'crown', 'megaphone', 'hearts', 'hourglass', 'sparkles',
  'boomerang', 'calendar', 'snail',
] as const

export type FxName = typeof FX_NAMES[number]

export const isFxName = (v: unknown): v is FxName => typeof v === 'string' && (FX_NAMES as readonly string[]).includes(v)

export const fxUrl = (name: FxName) => `/fx/${name}.png`
