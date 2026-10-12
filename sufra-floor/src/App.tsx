import React, { useEffect, useMemo, useState } from 'react'
import * as A from './actions'
import { fmtTime } from './core/reservations'
import type { Reservation } from './core/types'
import { deriveFloor } from './derive'
import { makeT, type Lang } from './i18n'
import { store, useStore, type FloorEvent } from './store'
import { UI, type UIState } from './ui/ctx'
import { FloorCanvas } from './ui/FloorCanvas'
import { Icon } from './ui/icons'
import { DesignPanel, ServicePanel } from './ui/Panels'
import { ReservationsView } from './ui/Reservations'

type Theme = 'system' | 'light' | 'dark'

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* ignore */
  }
}

export function App() {
  const { data, toasts } = useStore()
  const [lang, setLang] = useState<Lang>(() => readPref<Lang>('sufra-lang', 'ar'))
  const [theme, setTheme] = useState<Theme>(() => readPref<Theme>('sufra-theme', 'system'))
  const [screen, setScreen] = useState<'floor' | 'res'>(() => readPref('sufra-screen', 'floor'))
  const [ui, setUi] = useState<Omit<UIState, 'set' | 't' | 'lang'>>({
    mode: 'design',
    zoneId: data.layout.zones[0].id,
    selected: [],
    multi: false,
    locked: false,
    pick: null,
  })
  const [fitSignal, setFitSignal] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(true)
  const [editing, setEditing] = useState<Reservation | null>(null)
  const t = useMemo(() => makeT(lang), [lang])
  const ctx: UIState = { ...ui, lang, t, set: (patch) => setUi((u) => ({ ...u, ...patch })) }
  const floor = useMemo(() => deriveFloor(data), [data])
  const zone = data.layout.zones.find((z) => z.id === ui.zoneId) ?? data.layout.zones[0]

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    writePref('sufra-lang', lang)
  }, [lang])
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    writePref('sufra-theme', theme)
  }, [theme])
  useEffect(() => writePref('sufra-screen', screen), [screen])

  // Bills that merged or came apart because tables moved get a toast with a way back.
  const label = (id: string) => store.data.layout.tables.find((x) => x.id === id)?.label ?? id
  useEffect(() => {
    store.onFloorEvents = (events: FloorEvent[]) => {
      for (const e of events) {
        if (e.kind === 'merged') {
          store.pushToast({ tone: 'merge', text: t('merged', { t: e.tableIds.map(label).join(' + ') }), actions: [{ label: t('undo'), run: store.undo }] })
        } else {
          store.pushToast({
            tone: 'warn',
            text: t('separated', { t: e.tableIds.map(label).join(' + ') }),
            actions: [
              { label: t('splitNow'), run: () => store.splitBill(e.checkId) },
              { label: t('keepMerged'), run: () => A.linkTables(e.tableIds) },
            ],
          })
        }
      }
    }
  }, [t])

  // Drop selections that no longer exist (deleted, other zone).
  useEffect(() => {
    const ids = new Set([...data.layout.tables, ...data.layout.decor].filter((x) => x.zoneId === zone.id).map((x) => x.id))
    if (ui.selected.some((id) => !ids.has(id))) setUi((u) => ({ ...u, selected: u.selected.filter((id) => ids.has(id)) }))
  }, [data.layout, zone.id])

  const onTap = (id: string | null, toggle: boolean) => {
    if (ui.pick) {
      if (!id || !floor.tables.has(id) || id === ui.pick.fromTableId) return
      const from = ui.pick.fromTableId
      if (ui.pick.kind === 'transfer' && ui.pick.checkId) {
        A.transfer(ui.pick.checkId, from, id)
        store.pushToast({ tone: 'ok', text: `${label(from)} → ${label(id)}`, actions: [{ label: t('undo'), run: store.undo }] })
      } else {
        A.linkTables([from, id])
        store.pushToast({ tone: 'merge', text: t('mergedNoBill', { t: `${label(from)} + ${label(id)}` }), actions: [{ label: t('undo'), run: store.undo }] })
      }
      setUi((u) => ({ ...u, pick: null, selected: [id] }))
      return
    }
    if (!id) {
      if (!ui.multi) setUi((u) => ({ ...u, selected: [] }))
      return
    }
    setSheetOpen(true)
    if (toggle || ui.multi) {
      setUi((u) => ({ ...u, multi: true, selected: u.selected.includes(id) ? u.selected.filter((x) => x !== id) : [...u.selected, id] }))
    } else setUi((u) => ({ ...u, selected: [id] }))
  }

  const openReservation = (id: string) => {
    const r = data.reservations.find((x) => x.id === id)
    if (!r) return
    setScreen('res')
    setEditing(r)
  }

  return (
    <UI.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="28" height="28">
                <circle cx="16" cy="16" r="13" className="mark-tray" />
                <circle cx="16" cy="16" r="8" className="mark-plate" />
                <circle cx="16" cy="16" r="3" className="mark-dot" />
              </svg>
            </span>
            <b>{t('appName')}</b>
          </div>
          <nav className="seg main-nav" aria-label="screens">
            <button type="button" className={screen === 'floor' ? 'on' : ''} onClick={() => setScreen('floor')}>
              <Icon name="grid" size={16} />
              {t('floor')}
            </button>
            <button type="button" className={screen === 'res' ? 'on' : ''} onClick={() => setScreen('res')}>
              <Icon name="calendar" size={16} />
              {t('reservations')}
            </button>
          </nav>
          <div className="clock" title={t('demoClock')}>
            <button type="button" className="icon-btn" onClick={() => A.setNow(data.now - 15)} aria-label="-15">
              <Icon name="minus" size={14} />
            </button>
            <label htmlFor="clock-range" className="clock-face num">
              <Icon name="clock" size={15} />
              {fmtTime(data.now, lang)}
            </label>
            <input id="clock-range" type="range" min={12 * 60} max={26 * 60} step={5} value={data.now} onChange={(e) => A.setNow(Number(e.target.value))} />
            <button type="button" className="icon-btn" onClick={() => A.setNow(data.now + 15)} aria-label="+15">
              <Icon name="plus" size={14} />
            </button>
          </div>
          <div className="top-tools">
            <button type="button" className="icon-btn" onClick={store.undo} disabled={!store.canUndo} title={t('undo')} aria-label={t('undo')}>
              <Icon name="undo" />
            </button>
            <button type="button" className="icon-btn" onClick={store.redo} disabled={!store.canRedo} title={t('redo')} aria-label={t('redo')}>
              <Icon name="redo" />
            </button>
            <button type="button" className="icon-btn" onClick={() => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system')} title={t('theme')} aria-label={t('theme')}>
              <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'clock'} />
            </button>
            <button type="button" className="btn ghost small lang" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
              {t('lang')}
            </button>
          </div>
        </header>

        {screen === 'floor' ? (
          <main className={`floor-screen mode-${ui.mode} ${sheetOpen ? '' : 'sheet-closed'}`}>
            <div className="floor-bar">
              <div className="seg mode-seg">
                <button type="button" className={ui.mode === 'design' ? 'on' : ''} onClick={() => ctx.set({ mode: 'design', pick: null })}>
                  {t('design')}
                </button>
                <button type="button" className={ui.mode === 'service' ? 'on' : ''} onClick={() => ctx.set({ mode: 'service', selected: [], multi: false })}>
                  {t('service')}
                </button>
              </div>
              <div className="seg zones">
                {data.layout.zones.map((z) => (
                  <button key={z.id} type="button" className={z.id === zone.id ? 'on' : ''} onClick={() => ctx.set({ zoneId: z.id, selected: [] })}>
                    {z.name[lang]}
                  </button>
                ))}
              </div>
              <div className="bar-tools">
                <button
                  type="button"
                  className={`icon-btn ${ui.multi ? 'on' : ''}`}
                  onClick={() => ctx.set({ multi: !ui.multi, selected: ui.multi ? [] : ui.selected })}
                  title={t('multiSelect')}
                  aria-pressed={ui.multi}
                  aria-label={t('multiSelect')}
                >
                  <Icon name="multi" />
                </button>
                {ui.mode === 'service' && (
                  <button
                    type="button"
                    className={`icon-btn ${ui.locked ? 'on' : ''}`}
                    onClick={() => ctx.set({ locked: !ui.locked })}
                    title={t('lockLayout')}
                    aria-pressed={ui.locked}
                    aria-label={t('lockLayout')}
                  >
                    <Icon name={ui.locked ? 'lock' : 'unlock'} />
                  </button>
                )}
                <button type="button" className="icon-btn" onClick={() => setFitSignal((n) => n + 1)} title={t('fit')} aria-label={t('fit')}>
                  <Icon name="fit" />
                </button>
              </div>
            </div>

            <div className="canvas-wrap">
              <FloorCanvas zone={zone} floor={floor} data={data} onTap={onTap} fitSignal={fitSignal} />
              {ui.mode === 'design' && ui.selected.length === 0 && <p className="canvas-hint">{t('hintDesign')}</p>}
              {ui.pick && (
                <div className="pick-banner" role="status">
                  <Icon name={ui.pick.kind === 'transfer' ? 'arrow' : 'link'} />
                  <span>{t(ui.pick.kind === 'transfer' ? 'pickTransfer' : 'pickMerge')}</span>
                  <button type="button" className="btn small" onClick={() => ctx.set({ pick: null })}>
                    {t('cancel')}
                  </button>
                </div>
              )}
            </div>

            <aside className="side">
              <button type="button" className="sheet-grip" onClick={() => setSheetOpen(!sheetOpen)} aria-label="panel">
                <span />
              </button>
              {ui.mode === 'design' ? (
                <DesignPanel data={data} floor={floor} viewCenter={() => ({ x: zone.width / 2, y: zone.height / 2 })} />
              ) : (
                <ServicePanel key={ui.selected.join()} data={data} floor={floor} onOpenReservation={openReservation} />
              )}
              <button type="button" className="reset-link" onClick={() => (store.reset(), ctx.set({ selected: [], pick: null }))}>
                {t('resetDemo')}
              </button>
            </aside>
          </main>
        ) : (
          <main className="res-screen">
            <ReservationsView data={data} editing={editing} setEditing={setEditing} />
          </main>
        )}

        <div className="toasts" aria-live="polite">
          {toasts.map((x) => (
            <div key={x.id} className={`toast tone-${x.tone}`}>
              <span>{x.text}</span>
              {x.actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    a.run()
                    store.dismiss(x.id)
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </UI.Provider>
  )
}
