import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as A from '../actions'
import { isActive } from '../core/checks'
import {
  conflictsOf,
  defaultDuration,
  endOf,
  expectedFreeAt,
  fmtTime,
  isLate,
  isLive,
  SLOT,
  suggestTables,
  waitEstimate,
  type Suggestion,
} from '../core/reservations'
import type { Reservation, ReservationTag, Table } from '../core/types'
import { capacities } from '../derive'
import { store, uid, type Data } from '../store'
import { useUI } from './ctx'
import { Icon } from './icons'

const DAY_START = 12 * 60
const DAY_END = 26 * 60
const ROW_H = 46
const ZONE_H = 30
const LABEL_W = 76

const TAGS: ReservationTag[] = ['birthday', 'vip', 'kids', 'smoking', 'quiet']

const naturalLabel = (a: Table, b: Table) => a.label.localeCompare(b.label, 'en', { numeric: true })

type Row = { kind: 'zone'; zoneId: string; top: number } | { kind: 'table'; table: Table; top: number }

function buildRows(d: Data): { rows: Row[]; height: number } {
  const rows: Row[] = []
  let y = 34 // header with hours
  for (const z of d.layout.zones) {
    rows.push({ kind: 'zone', zoneId: z.id, top: y })
    y += ZONE_H
    for (const t of d.layout.tables.filter((x) => x.zoneId === z.id).sort(naturalLabel)) {
      rows.push({ kind: 'table', table: t, top: y })
      y += ROW_H
    }
  }
  return { rows, height: y + 8 }
}

export function ReservationsView({ data, editing, setEditing }: { data: Data; editing: Reservation | null; setEditing: (r: Reservation | null) => void }) {
  const ui = useUI()
  const { t } = ui
  const [tab, setTab] = useState<'timeline' | 'list' | 'waitlist'>('timeline')
  const live = data.reservations.filter((r) => r.status !== 'cancelled' && r.status !== 'no_show')
  const guests = live.reduce((s, r) => s + r.party, 0)

  const newAt = (start: number, tableIds: string[] = [], party = 2) =>
    setEditing({ id: uid('r'), name: '', phone: '', party, start, duration: defaultDuration(party), tableIds, status: 'confirmed', note: '', tags: [] })

  return (
    <div className="res-view">
      <header className="res-head">
        <div>
          <h2>{t('reservations')}</h2>
          <p className="muted">{t('todayStats', { r: live.length, g: guests })}</p>
        </div>
        <div className="seg tabs" role="tablist">
          {(['timeline', 'list', 'waitlist'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`${tab === k ? 'on' : ''} tab-${k}`} onClick={() => setTab(k)}>
              {t(k)}
              {k === 'waitlist' && data.waitlist.length > 0 && <b className="badge num">{data.waitlist.length}</b>}
            </button>
          ))}
        </div>
        <button type="button" className="btn accent" onClick={() => newAt(Math.ceil((data.now + 30) / SLOT) * SLOT)}>
          <Icon name="plus" size={16} />
          {t('newRes')}
        </button>
      </header>
      <div className={`res-body show-${tab}`}>
        <Timeline data={data} onOpen={setEditing} onNew={newAt} />
        <aside className="res-side">
          <div className="side-list">
            <ResList data={data} onOpen={setEditing} />
          </div>
          <div className="side-wait">
            <Waitlist data={data} />
          </div>
        </aside>
      </div>
      {editing && <ReservationSheet key={editing.id} data={data} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

type Drag = {
  id: string
  row: string
  mode: 'move' | 'resize'
  x0: number
  y0: number
  orig: Reservation
  moved: boolean
}

function Timeline({ data, onOpen, onNew }: { data: Data; onOpen: (r: Reservation) => void; onNew: (start: number, tableIds: string[], party: number) => void }) {
  const ui = useUI()
  const { t, lang } = ui
  const caps = useMemo(() => capacities(data), [data.layout])
  const { rows, height } = useMemo(() => buildRows(data), [data.layout])
  const tableRows = rows.filter((r): r is Extract<Row, { kind: 'table' }> => r.kind === 'table')
  const [ppm, setPpm] = useState(() => (window.innerWidth < 700 ? 1.6 : 2.2))
  const width = LABEL_W + (DAY_END - DAY_START) * ppm
  const x = (min: number) => LABEL_W + (min - DAY_START) * ppm
  const drag = useRef<Drag | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Open on the evening around "now" rather than at noon.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (data.now - 90 - DAY_START) * ppm)
  }, [])

  const rowAt = (clientY: number) => {
    const el = scrollRef.current!
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop
    return tableRows.find((r) => y >= r.top && y < r.top + ROW_H) ?? null
  }

  const onDown = (e: React.PointerEvent, r: Reservation, row: string, mode: Drag['mode']) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: r.id, row, mode, x0: e.clientX, y0: e.clientY, orig: r, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (!g.moved && Math.hypot(dx, dy) < 6) return
    if (!g.moved) {
      g.moved = true
      store.begin()
    }
    const dmin = Math.round(dx / ppm / SLOT) * SLOT
    let patch: Partial<Reservation>
    if (g.mode === 'resize') patch = { duration: Math.max(30, g.orig.duration + dmin) }
    else {
      const start = Math.min(DAY_END - 30, Math.max(DAY_START, g.orig.start + dmin))
      const target = rowAt(e.clientY)
      let tableIds = g.orig.tableIds
      if (target && target.table.id !== g.row && !g.orig.tableIds.includes(target.table.id)) {
        tableIds = g.orig.tableIds.map((id) => (id === g.row ? target.table.id : id))
      }
      patch = { start, tableIds }
    }
    store.preview((d) => ({ ...d, reservations: d.reservations.map((x) => (x.id === g.id ? { ...x, ...patch } : x)) }))
  }
  const onUp = () => {
    const g = drag.current
    drag.current = null
    if (!g) return
    if (g.moved) store.end()
    else onOpen(data.reservations.find((r) => r.id === g.id)!)
  }

  const onEmpty = (e: React.MouseEvent, table: Table) => {
    const el = scrollRef.current!
    const px = e.clientX - el.getBoundingClientRect().left + el.scrollLeft
    const start = Math.floor((DAY_START + (px - LABEL_W) / ppm) / SLOT) * SLOT
    onNew(start, [table.id], Math.min(caps.get(table.id) ?? 2, 4))
  }

  const hours = []
  for (let m = DAY_START; m <= DAY_END; m += 60) hours.push(m)

  // Occupancy from bills that did not come from a booking.
  const walkins = data.checks.filter((c) => isActive(c) && !data.reservations.some((r) => r.id === c.reservationId && r.status === 'seated'))

  return (
    <div className="tl-wrap">
      <div className="tl-tools">
        <p className="hint small">{t('dragHint')}</p>
        <div className="zoom">
          <button type="button" className="icon-btn" onClick={() => setPpm((p) => Math.max(1, p - 0.4))} aria-label="-">
            <Icon name="minus" size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setPpm((p) => Math.min(5, p + 0.4))} aria-label="+">
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>
      <div className="tl-scroll" ref={scrollRef} dir="ltr" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="tl-inner" style={{ width, height }}>
          {hours.map((m) => (
            <React.Fragment key={m}>
              <div className="tl-hour" style={{ left: x(m) }}>
                {fmtTime(m, lang).replace(':00', '')}
              </div>
              <div className="tl-vline" style={{ left: x(m), height }} />
              {m + 30 < DAY_END && <div className="tl-vline half" style={{ left: x(m + 30), height }} />}
            </React.Fragment>
          ))}
          {rows.map((r) =>
            r.kind === 'zone' ? (
              <div key={r.zoneId} className="tl-zone" style={{ top: r.top, width }}>
                <span>{data.layout.zones.find((z) => z.id === r.zoneId)!.name[lang]}</span>
              </div>
            ) : (
              <div key={r.table.id} className="tl-row" style={{ top: r.top, width }} onClick={(e) => onEmpty(e, r.table)}>
                <div className="tl-label">
                  <b>{r.table.label}</b>
                  <small>{caps.get(r.table.id)}</small>
                </div>
              </div>
            ),
          )}
          {walkins.flatMap((c) =>
            c.tableIds.map((id) => {
              const row = tableRows.find((r) => r.table.id === id)
              if (!row) return null
              const end = expectedFreeAt(c, data.now)
              return (
                <div key={`${c.id}-${id}`} className="tl-seated" style={{ left: x(c.openedAt), width: Math.max(8, (end - c.openedAt) * ppm), top: row.top + 6 }}>
                  <span>{t('seatedNow')}</span>
                </div>
              )
            }),
          )}
          {data.reservations
            .filter((r) => r.status !== 'cancelled')
            .flatMap((r) =>
              r.tableIds.map((id, i) => {
                const row = tableRows.find((x) => x.table.id === id)
                if (!row) return null
                const clash = conflictsOf(r, data.reservations).length > 0
                const small = r.party > r.tableIds.reduce((s, x) => s + (caps.get(x) ?? 0), 0)
                const late = isLate(r, data.now)
                return (
                  <div
                    key={`${r.id}-${id}`}
                    className={`tl-res rs-${r.status} ${clash ? 'clash' : ''} ${late ? 'late' : ''} ${i > 0 ? 'secondary' : ''}`}
                    style={{ left: x(r.start), width: Math.max(24, r.duration * ppm), top: row.top + 4 }}
                    onPointerDown={(e) => onDown(e, r, id, 'move')}
                    title={`${r.name} · ${r.party}`}
                  >
                    <span className="tl-res-time num">{fmtTime(r.start, lang)}</span>
                    <span className="tl-res-name">{r.name}</span>
                    <span className="tl-res-party num">
                      <Icon name="people" size={13} />
                      {r.party}
                    </span>
                    {(clash || small) && (
                      <span className="tl-flag" title={clash ? t('conflict') : t('tooSmall')}>
                        <Icon name="warn" size={13} />
                      </span>
                    )}
                    {r.tags.includes('birthday') && <span className="tl-tag" title={t('birthday')}>
                        <Icon name="cake" size={13} />
                      </span>}
                    <span className="tl-grip" onPointerDown={(e) => onDown(e, r, id, 'resize')} />
                  </div>
                )
              }),
            )}
          <div className="tl-now" style={{ left: x(data.now), height }}>
            <span>{fmtTime(data.now, lang)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function StatusChip({ r, now }: { r: Reservation; now: number }) {
  const { t } = useUI()
  if (isLate(r, now)) return <span className="chip-st rs-late">{t('late', { n: now - r.start })}</span>
  return <span className={`chip-st rs-${r.status}`}>{t(r.status)}</span>
}

function ResList({ data, onOpen }: { data: Data; onOpen: (r: Reservation) => void }) {
  const ui = useUI()
  const { t, lang } = ui
  const sorted = [...data.reservations].sort((a, b) => a.start - b.start)
  const groups: Array<[string, Reservation[]]> = [
    [t('upcoming'), sorted.filter((r) => r.status === 'pending' || r.status === 'confirmed')],
    [t('seatedNow'), sorted.filter((r) => r.status === 'seated')],
    [t('pastRes'), sorted.filter((r) => !isLive(r))],
  ]
  const label = (id: string) => data.layout.tables.find((x) => x.id === id)?.label ?? id
  return (
    <div className="res-list">
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title}>
            <h4>
              {title} <span className="num muted">{list.length}</span>
            </h4>
            {list.map((r) => {
              const clash = conflictsOf(r, data.reservations).length > 0
              return (
                <button key={r.id} type="button" className={`res-card ${clash ? 'clash' : ''}`} onClick={() => onOpen(r)}>
                  <span className="rc-time num">{fmtTime(r.start, lang)}</span>
                  <span className="rc-main">
                    <b>{r.name}</b>
                    <small>
                      <Icon name="people" size={13} /> {r.party} · {r.tableIds.map(label).join(' + ') || '—'}
                      {r.tags.length > 0 && ` · ${r.tags.map((x) => t(x)).join('، ')}`}
                    </small>
                  </span>
                  <StatusChip r={r} now={data.now} />
                  {clash && (
                    <span className="rc-flag" title={t('conflict')}>
                      <Icon name="warn" size={15} />
                    </span>
                  )}
                </button>
              )
            })}
          </section>
        ) : null,
      )}
    </div>
  )
}

function Waitlist({ data }: { data: Data }) {
  const ui = useUI()
  const { t, lang } = ui
  const [name, setName] = useState('')
  const [party, setParty] = useState(2)
  const [phone, setPhone] = useState('')
  const [seating, setSeating] = useState<string | null>(null)

  return (
    <div className="waitlist">
      <h4>{t('waitlist')}</h4>
      <form
        className="wait-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          A.addWait({ name: name.trim(), party, phone })
          setName('')
          setPhone('')
          setParty(2)
        }}
      >
        <input id="w-name" placeholder={t('name')} value={name} onChange={(e) => setName(e.target.value)} />
        <input id="w-phone" placeholder={t('phone')} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="party-pick">
          <button type="button" onClick={() => setParty(Math.max(1, party - 1))} aria-label="-">
            <Icon name="minus" size={14} />
          </button>
          <span className="num">{party}</span>
          <button type="button" onClick={() => setParty(party + 1)} aria-label="+">
            <Icon name="plus" size={14} />
          </button>
        </div>
        <button type="submit" className="btn accent">
          {t('addWait')}
        </button>
      </form>
      {data.waitlist.map((w) => {
        const est = waitEstimate(w.party, data.layout, data.reservations, data.checks, data.now)
        const options = seating === w.id ? suggestTables(w.party, data.now, defaultDuration(w.party), data.layout, data.reservations, data.checks, data.now) : []
        return (
          <div key={w.id} className="wait-card">
            <div className="wc-top">
              <span className="rc-main">
                <b>{w.name}</b>
                <small>
                  <Icon name="people" size={13} /> {w.party} · {t('waiting', { n: data.now - w.addedAt })}
                </small>
              </span>
              <span className={`wait-est ${est === 0 ? 'now' : ''}`}>{est === null ? t('waitNone') : est === 0 ? t('waitNow') : t('waitFor', { n: est })}</span>
            </div>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={() => setSeating(seating === w.id ? null : w.id)} disabled={est !== 0}>
                {t('seat')}
              </button>
              <button type="button" className="btn small ghost" onClick={() => A.removeWait(w.id)}>
                <Icon name="x" size={14} />
              </button>
            </div>
            {options.length > 0 && (
              <div className="sugg-row">
                {options.map((s) => (
                  <button
                    key={s.tableIds.join()}
                    type="button"
                    className="sugg mini"
                    onClick={() => {
                      if (s.reasons.includes('push')) A.pushIdsTogether(s.tableIds)
                      A.seatTables(s.tableIds, w.party)
                      A.removeWait(w.id)
                      setSeating(null)
                      store.pushToast({ tone: 'ok', text: t('seatedOk', { name: w.name, t: s.tableIds.join(' + ') }), actions: [] })
                    }}
                  >
                    <b>{s.tableIds.map((id) => data.layout.tables.find((x) => x.id === id)?.label).join(' + ')}</b>
                    <small>
                      {s.capacity} {t('seats')}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {data.waitlist.length === 0 && <p className="muted small">{lang === 'ar' ? 'مفيش حد مستني' : 'Nobody waiting'}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ReservationSheet({ data, initial, onClose }: { data: Data; initial: Reservation; onClose: () => void }) {
  const ui = useUI()
  const { t, lang } = ui
  const exists = data.reservations.some((r) => r.id === initial.id)
  const [r, setR] = useState<Reservation>(initial)
  const [zonePref, setZonePref] = useState<string>('')
  const [durTouched, setDurTouched] = useState(exists)
  const [error, setError] = useState('')
  const caps = useMemo(() => capacities(data), [data.layout])
  const set = (patch: Partial<Reservation>) => setR((x) => ({ ...x, ...patch }))

  const suggestions: Suggestion[] = useMemo(
    () => suggestTables(r.party, r.start, r.duration, data.layout, data.reservations, data.checks, data.now, { zoneId: zonePref || undefined, excludeId: r.id }),
    [r.party, r.start, r.duration, zonePref, data],
  )
  const clashes = conflictsOf(r, data.reservations.map((x) => (x.id === r.id ? r : x)))
  const capSum = r.tableIds.reduce((s, id) => s + (caps.get(id) ?? 0), 0)
  const label = (id: string) => data.layout.tables.find((x) => x.id === id)?.label ?? id
  const times: number[] = []
  for (let m = DAY_START; m < DAY_END; m += SLOT) times.push(m)
  if (!times.includes(r.start)) times.push(r.start)
  times.sort((a, b) => a - b)

  const save = (patch: Partial<Reservation> = {}) => {
    if (!r.name.trim()) return setError(t('requiredName'))
    if (!r.tableIds.length) return setError(t('noTable'))
    A.saveReservation({ ...r, ...patch, name: r.name.trim() })
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={(e) => (e.preventDefault(), save())}>
        <header className="sheet-top">
          <h3>{exists ? t('editRes') : t('newRes')}</h3>
          {exists && <StatusChip r={r} now={data.now} />}
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="form-grid">
          <label className="fld">
            <span>{t('name')}</span>
            <input id="r-name" value={r.name} onChange={(e) => (set({ name: e.target.value }), setError(''))} autoFocus={!exists} />
          </label>
          <label className="fld">
            <span>{t('phone')}</span>
            <input id="r-phone" inputMode="tel" value={r.phone} onChange={(e) => set({ phone: e.target.value })} />
          </label>
          <div className="fld">
            <span>{t('party')}</span>
            <div className="party-big">
              {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={r.party === n ? 'on' : ''}
                  onClick={() => set({ party: n, ...(durTouched ? {} : { duration: defaultDuration(n) }) })}
                >
                  {n}
                </button>
              ))}
              <input
                id="r-party"
                className="num"
                inputMode="numeric"
                value={r.party}
                aria-label={t('party')}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(80, Number(e.target.value.replace(/\D/g, '')) || 1))
                  set({ party: n, ...(durTouched ? {} : { duration: defaultDuration(n) }) })
                }}
              />
            </div>
          </div>
          <label className="fld">
            <span>{t('time')}</span>
            <select id="r-time" value={r.start} onChange={(e) => set({ start: Number(e.target.value) })}>
              {times.map((m) => (
                <option key={m} value={m}>
                  {fmtTime(m, lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="fld">
            <span>{t('duration')}</span>
            <select
              id="r-dur"
              value={r.duration}
              onChange={(e) => {
                setDurTouched(true)
                set({ duration: Number(e.target.value) })
              }}
            >
              {[45, 60, 75, 90, 105, 120, 150, 180, 240].map((m) => (
                <option key={m} value={m}>
                  {m} {t('min')}
                </option>
              ))}
            </select>
          </label>
          <label className="fld">
            <span>{t('prefZone')}</span>
            <select id="r-zone" value={zonePref} onChange={(e) => setZonePref(e.target.value)}>
              <option value="">{t('anyZone')}</option>
              {data.layout.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name[lang]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="fld">
          <span>{t('tags')}</span>
          <div className="tag-row">
            {TAGS.map((g) => (
              <button
                key={g}
                type="button"
                className={`chip ${r.tags.includes(g) ? 'on' : ''}`}
                onClick={() => set({ tags: r.tags.includes(g) ? r.tags.filter((x) => x !== g) : [...r.tags, g] })}
              >
                {t(g)}
              </button>
            ))}
          </div>
        </div>
        <label className="fld">
          <span>{t('note')}</span>
          <input id="r-note" value={r.note} onChange={(e) => set({ note: e.target.value })} />
        </label>

        <div className="fld">
          <span>{t('suggested')}</span>
          {suggestions.length === 0 ? (
            <p className="muted small">{t('noSuggestion')}</p>
          ) : (
            <div className="sugg-row">
              {suggestions.map((s, i) => {
                const on = s.tableIds.length === r.tableIds.length && s.tableIds.every((x) => r.tableIds.includes(x))
                return (
                  <button key={s.tableIds.join()} type="button" className={`sugg ${on ? 'on' : ''} ${i === 0 ? 'best' : ''}`} onClick={() => (set({ tableIds: s.tableIds }), setError(''))}>
                    <b>{s.tableIds.map(label).join(' + ')}</b>
                    <small>
                      {s.capacity} {t('seats')} · {data.layout.zones.find((z) => z.id === data.layout.tables.find((x) => x.id === s.tableIds[0])?.zoneId)?.name[lang]}
                    </small>
                    <span className="why">{s.reasons.map((x) => t(x === 'zone' ? 'zoneMatch' : x)).join(' · ')}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <details className="manual" open={r.tableIds.length > 0 && !suggestions.some((s) => s.tableIds.join() === r.tableIds.join())}>
          <summary>{t('manualPick')}</summary>
          <div className="table-chips">
            {data.layout.tables
              .slice()
              .sort(naturalLabel)
              .map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  className={`chip ${r.tableIds.includes(tb.id) ? 'on' : ''}`}
                  onClick={() => set({ tableIds: r.tableIds.includes(tb.id) ? r.tableIds.filter((x) => x !== tb.id) : [...r.tableIds, tb.id] })}
                >
                  {tb.label} <small className="num">{caps.get(tb.id)}</small>
                </button>
              ))}
          </div>
        </details>

        {(clashes.length > 0 || (r.tableIds.length > 0 && capSum < r.party)) && (
          <div className="warn-box">
            {clashes.length > 0 && (
              <p>
                <Icon name="warn" size={16} /> {t('conflict')}: {clashes.map((c) => `${c.name} ${fmtTime(c.start, lang)}`).join('، ')}
              </p>
            )}
            {r.tableIds.length > 0 && capSum < r.party && (
              <p>
                <Icon name="warn" size={16} /> {t('tooSmall')} ({capSum} / {r.party})
              </p>
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}

        <footer className="sheet-actions">
          <button type="submit" className="btn accent">
            {t('save')}
          </button>
          {exists && r.status === 'pending' && (
            <button type="button" className="btn" onClick={() => save({ status: 'confirmed' })}>
              <Icon name="check" size={16} />
              {t('confirm')}
            </button>
          )}
          {exists && (r.status === 'pending' || r.status === 'confirmed') && (
            <>
              <button
                type="button"
                className="btn ok"
                onClick={() => {
                  A.saveReservation(r)
                  A.seatReservation(r.id)
                  store.pushToast({ tone: 'ok', text: t('seatedOk', { name: r.name, t: r.tableIds.map(label).join(' + ') }), actions: [{ label: t('undo'), run: store.undo }] })
                  onClose()
                }}
              >
                <Icon name="people" size={16} />
                {t('seat')}
              </button>
              <button type="button" className="btn" onClick={() => (A.patchReservation(r.id, { status: 'no_show' }), onClose())}>
                {t('noShow')}
              </button>
              <button type="button" className="btn" onClick={() => (A.patchReservation(r.id, { status: 'cancelled' }), onClose())}>
                {t('cancelRes')}
              </button>
            </>
          )}
          {exists && !isLive(r) && (
            <button type="button" className="btn danger" onClick={() => (A.deleteReservation(r.id), onClose())}>
              <Icon name="trash" size={16} />
              {t('deleteRes')}
            </button>
          )}
          <span className="sheet-meta muted small num">
            {fmtTime(r.start, lang)} – {fmtTime(endOf(r), lang)}
          </span>
        </footer>
      </form>
    </div>
  )
}
