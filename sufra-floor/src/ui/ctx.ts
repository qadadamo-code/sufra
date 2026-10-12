import { createContext, useContext } from 'react'
import type { Lang, T } from '../i18n'

export type Pick = { kind: 'transfer' | 'merge'; fromTableId: string; checkId: string | null }

export interface UIState {
  lang: Lang
  t: T
  mode: 'design' | 'service'
  zoneId: string
  selected: string[] // table or decor ids
  multi: boolean
  locked: boolean
  pick: Pick | null
  set: (patch: Partial<Omit<UIState, 'set' | 't'>>) => void
}

export const UI = createContext<UIState>(null as unknown as UIState)
export const useUI = () => useContext(UI)
