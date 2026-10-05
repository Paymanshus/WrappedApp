import latin from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url'
import latinExt from '@fontsource-variable/archivo/files/archivo-latin-ext-wdth-normal.woff2?url'

// Display face for Rewind headlines and big numbers: Archivo (OFL, self-hosted), registered
// as its own family with a fixed condensed width. A `stretch: 75%` FontFace is the one way
// to get the condensed instance in *canvas* across engines — WebKit ignores ctx.fontStretch —
// so the DOM story, SVG scenes and exported PNG/MP4 all render the same letterforms.

export const DISPLAY_FAMILY = 'Archivo Display'

let ready: Promise<void> | null = null

export function loadDisplayFont(): Promise<void> {
  if (ready) return ready
  if (typeof FontFace === 'undefined' || !document.fonts) return (ready = Promise.resolve())
  const desc = { weight: '100 900', stretch: '75%', display: 'swap' } as const
  const faces = [
    new FontFace(DISPLAY_FAMILY, `url(${latin}) format('woff2')`, { ...desc, unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' }),
    new FontFace(DISPLAY_FAMILY, `url(${latinExt}) format('woff2')`, { ...desc, unicodeRange: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' }),
  ]
  faces.forEach(f => document.fonts.add(f))
  ready = Promise.all(faces.map(f => f.load())).then(() => {}, () => {})
  return ready
}
