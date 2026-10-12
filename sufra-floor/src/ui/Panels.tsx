import React, { useState } from 'react'
import * as A from '../actions'
import { checkTotal, formatMoney } from '../core/checks'
import { autoSeatCount } from '../core/seats'
import { sizeForSeats } from '../core/layout'
import { expectedFreeAt, fmtTime, isLate } from '../core/reservations'
import type { DecorKind, Shape, Table } from '../core/types'
import type { FloorView } from '../derive'
import { MENU } from '../seed'
import { store, type Data } from '../store'
import { useUI } from './ctx'
import { Icon } from './icons'

const SHAPES: Shape[] = ['square', 'rect', 'round', 'oval', 'booth', 'bar']
const DECOR: DecorKind[] = ['wall', 'pillar', 'door', 'counter', 'plant', 'window']

function Stepper({ id, value, onChange, step = 1, min = 0, max = 999, unit }: { id: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} aria-label="-">
        <Icon name="minus" size={16} />
      </button>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value.replace(/[^\d]/g, ''))
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
      {unit && <span className="unit">{unit}</span>}
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} aria-label="+">
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}

function ConfirmButton({ label, confirmLabel, onConfirm, icon = 'trash' }: { label: string; confirmLabel: string; onConfirm: () => void; icon?: string }) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      className={`btn danger ${armed ? 'armed' : ''}`}
      onClick={() => (armed ? (onConfirm(), setArmed(false)) : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      <Icon name={icon} size={16} />
      {armed ? confirmLabel : label}
    </button>
  )
}

// ---------------------------------------------------------------------------

export function DesignPanel({ data, floor, viewCenter }: { data: Data; floor: FloorView; viewCenter: () => { x: number; y: number } }) {
  const ui = useUI()
  const { t } = ui
  const sel = ui.selected
  const table = sel.length === 1 ? data.layout.tables.find((x) => x.id === sel[0]) : undefined
  const decor = sel.length === 1 ? data.layout.decor.find((x) => x.id === sel[0]) : undefined
  const selTables = data.layout.tables.filter((x) => sel.includes(x.id))

  return (
    <div className="panel-body">
      <section className="pal">
        <h3>{t('addTable')}</h3>
        <div className="shape-grid">
          {SHAPES.map((s) => (
            <button key={s} type="button" className="shape-btn" onClick={() => ui.set({ selected: [A.addTable(ui.zoneId, s, viewCenter())] })}>
              <Icon name={s} size={26} />
              <span>{t(s)}</span>
            </button>
          ))}
        </div>
        <details className="decor-add">
          <summary>{t('addDecor')}</summary>
          <div className="shape-grid">
            {DECOR.map((k) => (
              <button key={k} type="button" className="shape-btn" onClick={() => ui.set({ selected: [A.addDecor(ui.zoneId, k, viewCenter())] })}>
                <Icon name={k} size={22} />
                <span>{t(k)}</span>
              </button>
            ))}
          </div>
        </details>
      </section>

      {table && <TableInspector table={table} floor={floor} data={data} />}

      {decor && (
        <section className="insp">
          <h3>{t(decor.kind)}</h3>
          <div className="field-row">
            <label htmlFor="d-w">{t('width')}</label>
            <Stepper id="d-w" value={decor.w} step={10} min={10} max={2000} unit={t('cm')} onChange={(w) => A.updateItem(decor.id, { w })} />
          </div>
          <div className="field-row">
            <label htmlFor="d-h">{t('depth')}</label>
            <Stepper id="d-h" value={decor.h} step={10} min={10} max={2000} unit={t('cm')} onChange={(h) => A.updateItem(decor.id, { h })} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => A.rotate([decor.id])}>
              <Icon name="rotate" size={16} />
              {t('rotate')}
            </button>
            <button type="button" className="btn" onClick={() => ui.set({ selected: A.duplicate([decor.id]) })}>
              <Icon name="copy" size={16} />
              {t('duplicate')}
            </button>
            <ConfirmButton label={t('remove')} confirmLabel={t('confirmRemove')} onConfirm={() => (A.removeItems([decor.id]), ui.set({ selected: [] }))} />
          </div>
        </section>
      )}

      {selTables.length > 1 && (
        <section className="insp">
          <h3>{t('selected', { n: selTables.length })}</h3>
          <div className="btn-grid">
            <button type="button" className="btn" onClick={() => A.align(sel, 'top')}>
              <Icon name="alignTop" size={16} />
              {t('alignTop')}
            </button>
            <button type="button" className="btn" onClick={() => A.spread(sel)} disabled={selTables.length < 3}>
              <Icon name="spread" size={16} />
              {t('spread')}
            </button>
            <button type="button" className="btn accent" onClick={() => A.pushIdsTogether(selTables.map((x) => x.id))}>
              <Icon name="magnet" size={16} />
              {t('pushTogether')}
            </button>
            <button type="button" className="btn" onClick={() => A.linkTables(selTables.map((x) => x.id))}>
              <Icon name="link" size={16} />
              {t('linkBills')}
            </button>
            {data.links.some((l) => l.tableIds.some((x) => sel.includes(x))) && (
              <button type="button" className="btn" onClick={() => A.unlinkTables(sel)}>
                <Icon name="unlink" size={16} />
                {t('unlink')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => ui.set({ selected: A.duplicate(sel) })}>
              <Icon name="copy" size={16} />
              {t('duplicate')}
            </button>
            <ConfirmButton label={t('remove')} confirmLabel={t('confirmRemove')} onConfirm={() => ui.set({ selected: A.removeItems(sel) })} />
          </div>
        </section>
      )}

      {sel.length === 0 && <p className="hint">{t('emptyInspector')}</p>}

      <section className="base-row">
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            A.saveBase()
            store.pushToast({ tone: 'ok', text: t('baseSaved'), actions: [] })
          }}
        >
          <Icon name="check" size={16} />
          {t('saveBase')}
        </button>
        <button type="button" className="btn ghost" onClick={A.restoreBase}>
          <Icon name="reset" size={16} />
          {t('restoreBase')}
        </button>
      </section>
    </div>
  )
}

function TableInspector({ table, floor, data }: { table: Table; floor: FloorView; data: Data }) {
  const ui = useUI()
  const { t } = ui
  const tv = floor.tables.get(table.id)!
  const auto = table.seatsOverride == null
  const square = table.shape === 'square' || table.shape === 'round'
  const blocked = tv.chairs.filter((c) => c.blocked).length
  return (
    <section className="insp">
      <div className="insp-head">
        <input
          id="t-label"
          className="label-input"
          value={table.label}
          aria-label={t('name')}
          onChange={(e) => A.updateItem(table.id, { label: e.target.value.slice(0, 8) })}
        />
        <div className="seat-big">
          <strong>{tv.capacity}</strong>
          <span>{t('seats')}</span>
        </div>
      </div>
      {tv.overlaps && (
        <p className="warn-line">
          <Icon name="warn" size={16} />
          {t('overlapWarn')}
        </p>
      )}

      <div className="seg" role="radiogroup" aria-label={t('shape')}>
        {(['square', 'rect', 'round', 'oval', 'booth', 'bar'] as Shape[]).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={table.shape === s} className={table.shape === s ? 'on' : ''} onClick={() => A.setShape(table.id, s)} title={t(s)}>
            <Icon name={s} size={20} />
          </button>
        ))}
      </div>

      <div className="field-row">
        <label htmlFor="t-w">{square ? t('size') : t('width')}</label>
        <Stepper
          id="t-w"
          value={table.w}
          step={10}
          min={40}
          max={600}
          unit={t('cm')}
          onChange={(w) => A.updateItem(table.id, square ? { w, h: w } : { w })}
        />
      </div>
      {!square && (
        <div className="field-row">
          <label htmlFor="t-h">{t('depth')}</label>
          <Stepper id="t-h" value={table.h} step={10} min={40} max={600} unit={t('cm')} onChange={(h) => A.updateItem(table.id, { h })} />
        </div>
      )}

      <div className="quick">
        <span>{t('quickSize')}</span>
        {[2, 4, 6, 8, 10].map((n) => (
          <button key={n} type="button" className="chip" onClick={() => A.updateItem(table.id, { ...sizeForSeats(table.shape, n), seatsOverride: null })}>
            {n}
          </button>
        ))}
      </div>

      <div className="seats-box">
        <div className="seg two">
          <button type="button" className={auto ? 'on' : ''} onClick={() => A.updateItem(table.id, { seatsOverride: null })}>
            {t('autoSeats')}
          </button>
          <button type="button" className={!auto ? 'on' : ''} onClick={() => A.updateItem(table.id, { seatsOverride: autoSeatCount(table) })}>
            {t('manualSeats')}
          </button>
        </div>
        {!auto && (
          <Stepper id="t-seats" value={table.seatsOverride!} min={1} max={30} onChange={(n) => A.updateItem(table.id, { seatsOverride: n })} />
        )}
        {blocked > 0 && (
          <p className="muted small">
            {ui.lang === 'ar' ? `${blocked} كرسي متشال عشان الطاولة لازقة في حاجة` : `${blocked} chair(s) removed where the table touches something`}
          </p>
        )}
      </div>

      {data.layout.zones.length > 1 && (
        <div className="field-row">
          <label htmlFor="t-zone">{t('moveToZone')}</label>
          <select id="t-zone" value={table.zoneId} onChange={(e) => A.updateItem(table.id, { zoneId: e.target.value })}>
            {data.layout.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name[ui.lang]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => A.rotate([table.id])}>
          <Icon name="rotate" size={16} />
          {t('rotate')}
        </button>
        <button type="button" className="btn" onClick={() => ui.set({ selected: A.duplicate([table.id]) })}>
          <Icon name="copy" size={16} />
          {t('duplicate')}
        </button>
        <ConfirmButton
          label={t('remove')}
          confirmLabel={t('confirmRemove')}
          onConfirm={() => {
            const kept = A.removeItems([table.id])
            ui.set({ selected: kept })
          }}
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

export function ServicePanel({ data, floor, onOpenReservation }: { data: Data; floor: FloorView; onOpenReservation: (id: string) => void }) {
  const ui = useUI()
  const { t } = ui
  const sel = ui.selected.filter((id) => floor.tables.has(id))

  if (sel.length > 1) {
    return (
      <div className="panel-body">
        <section className="insp">
          <h3>{t('selected', { n: sel.length })}</h3>
          <p className="muted">{sel.map((id) => floor.tables.get(id)!.table.label).join(' + ')}</p>
          <div className="btn-grid">
            <button type="button" className="btn accent" onClick={() => (A.linkTables(sel), ui.set({ selected: [sel[0]], multi: false }))}>
              <Icon name="link" size={16} />
              {t('linkBills')}
            </button>
            {!ui.locked && (
              <button type="button" className="btn" onClick={() => A.pushIdsTogether(sel)}>
                <Icon name="magnet" size={16} />
                {t('pushTogether')}
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => ui.set({ selected: [], multi: false })}>
              {t('clearSel')}
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (sel.length === 1) return <TableSheet tv={floor.tables.get(sel[0])!} data={data} floor={floor} onOpenReservation={onOpenReservation} />
  return <ServiceOverview data={data} floor={floor} onOpenReservation={onOpenReservation} />
}

function ServiceOverview({ data, floor, onOpenReservation }: { data: Data; floor: FloorView; onOpenReservation: (id: string) => void }) {
  const ui = useUI()
  const { t } = ui
  const all = [...floor.tables.values()]
  const count = (s: string) => all.filter((x) => x.status === s).length
  const seats = all.reduce((s, x) => s + x.capacity, 0)
  const seated = data.checks.filter((c) => c.status !== 'paid').reduce((s, c) => s + c.guests, 0)
  const risks = all.filter((x, i) => x.atRisk && all.findIndex((y) => y.atRisk && y.next?.id === x.next?.id) === i)
  const late = data.reservations.filter((r) => isLate(r, data.now))
  return (
    <div className="panel-body">
      <section className="occupancy">
        <div className="occ-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (seated / Math.max(1, seats)) * 100)}%` }} />
        </div>
        <p>
          <strong className="num">{seated}</strong> / <span className="num">{seats}</span> {ui.lang === 'ar' ? 'كرسي مشغول' : 'seats taken'}
        </p>
        <ul className="legend">
          {(['free', 'occupied', 'bill', 'reserved', 'dirty'] as const).map((s) => (
            <li key={s}>
              <i className={`dot st-${s}`} />
              <span>{t(s === 'bill' ? 'billReq' : s === 'reserved' ? 'reservedSoon' : s)}</span>
              <b className="num">{count(s)}</b>
            </li>
          ))}
        </ul>
      </section>
      {(risks.length > 0 || late.length > 0) && (
        <section className="alerts">
          {risks.map((x) => (
            <button key={x.table.id} type="button" className="alert risk" onClick={() => onOpenReservation(x.next!.id)}>
              <Icon name="warn" size={18} />
              <span>
                <b>{x.table.label}</b> · {t('resAtRisk', { time: fmtTime(x.next!.start, ui.lang), free: fmtTime(expectedFreeAt(x.check!, data.now), ui.lang) })}
              </span>
              <em>{t('moveRes')}</em>
            </button>
          ))}
          {late.map((r) => (
            <button key={r.id} type="button" className="alert late" onClick={() => onOpenReservation(r.id)}>
              <Icon name="clock" size={18} />
              <span>
                <b>{r.name}</b> · {r.tableIds.join('+')} · {t('late', { n: data.now - r.start })}
              </span>
            </button>
          ))}
        </section>
      )}
      <p className="hint">{t('hintTouch')}</p>
    </div>
  )
}

function TableSheet({ tv, data, floor, onOpenReservation }: { tv: FloorView['tables'] extends Map<string, infer V> ? V : never; data: Data; floor: FloorView; onOpenReservation: (id: string) => void }) {
  const ui = useUI()
  const { t, lang } = ui
  const [guests, setGuests] = useState(Math.min(2, tv.capacity) || 2)
  const { table, check } = tv
  const dirty = data.dirty.find((x) => x.tableId === table.id)
  const label = check ? check.tableIds.map((id) => floor.tables.get(id)?.table.label ?? id).join(' + ') : table.label
  const cap = check ? check.tableIds.reduce((s, id) => s + (floor.tables.get(id)?.capacity ?? 0), 0) : tv.capacity
  const name = (id: string) => MENU.find((m) => m.id === id)?.name[lang] ?? id
  const merged = !!check && check.tableIds.length > 1
  const soon = tv.next

  return (
    <div className="panel-body">
      <section className={`sheet-head st-${tv.status}`}>
        <div>
          <h3>{label}</h3>
          <p className="muted">
            {t(tv.status === 'bill' ? 'billReq' : tv.status === 'reserved' ? 'reservedSoon' : tv.status)} · {t('capacity')} {cap}
            {check && ` · ${t('seatedFor', { n: Math.max(0, data.now - check.openedAt) })}`}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={() => ui.set({ selected: [] })} aria-label={t('close')}>
          <Icon name="x" />
        </button>
      </section>

      {soon && (
        <button type="button" className={`alert ${tv.atRisk ? 'risk' : 'info'}`} onClick={() => onOpenReservation(soon.id)}>
          <Icon name={tv.atRisk ? 'warn' : 'calendar'} size={18} />
          <span>
            {t('resAt', { time: fmtTime(soon.start, lang), n: soon.party })} · <b>{soon.name}</b>
            {isLate(soon, data.now) && ` · ${t('late', { n: data.now - soon.start })}`}
          </span>
        </button>
      )}

      {!check && dirty && (
        <button type="button" className="btn big ok" onClick={() => A.markClean(table.id)}>
          <Icon name="check" />
          {t('markClean')}
        </button>
      )}

      {!check && !dirty && (
        <section className="open-box">
          {soon && soon.start - data.now <= 30 && (
            <button type="button" className="btn big accent" onClick={() => A.seatReservation(soon.id)}>
              <Icon name="people" />
              {t('seatRes', { name: soon.name })}
            </button>
          )}
          <div className="field-row">
            <label htmlFor="g-n">{t('guests')}</label>
            <Stepper id="g-n" value={guests} min={1} max={40} onChange={setGuests} />
          </div>
          <button type="button" className="btn big" onClick={() => A.seatTables([table.id], guests)}>
            <Icon name="plus" />
            {t('openTable')}
          </button>
        </section>
      )}

      {check && (
        <>
          <section className="lines">
            {check.lines.length === 0 && <p className="muted">{t('noBillYet')}</p>}
            {check.lines.map((l) => (
              <div key={l.id} className="line">
                <div className="qty">
                  <button type="button" onClick={() => A.changeQty(check.id, l.id, -1)} aria-label="-">
                    <Icon name="minus" size={14} />
                  </button>
                  <span className="num">{l.qty}</span>
                  <button type="button" onClick={() => A.changeQty(check.id, l.id, 1)} aria-label="+">
                    <Icon name="plus" size={14} />
                  </button>
                </div>
                <span className="lname">
                  {name(l.itemId)}
                  {merged && <em className="origin">{t('from', { t: floor.tables.get(l.originTableId)?.table.label ?? l.originTableId })}</em>}
                </span>
                <span className="num">{formatMoney(l.qty * l.unitPrice, lang)}</span>
              </div>
            ))}
            <div className="line total">
              <span>{t('total')}</span>
              <span className="num">{formatMoney(checkTotal(check), lang)}</span>
            </div>
          </section>

          <section>
            <h4>{t('addItems')}</h4>
            <div className="menu-chips">
              {MENU.map((m) => (
                <button key={m.id} type="button" className="chip menu" onClick={() => A.orderItem(check.id, m, table.id)}>
                  <span>{m.name[lang]}</span>
                  <small className="num">{(m.price / 100).toFixed(0)}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="field-row">
            <label htmlFor="g-edit">{t('guests')}</label>
            <Stepper id="g-edit" value={check.guests} min={1} max={60} onChange={(n) => A.setGuests(check.id, n)} />
          </section>

          <section className="btn-grid">
            <button type="button" className="btn" onClick={() => ui.set({ pick: { kind: 'transfer', fromTableId: table.id, checkId: check.id } })}>
              <Icon name="arrow" size={16} />
              {t('transfer')}
            </button>
            <button type="button" className="btn" onClick={() => ui.set({ pick: { kind: 'merge', fromTableId: table.id, checkId: check.id } })}>
              <Icon name="link" size={16} />
              {t('mergeWith')}
            </button>
            {merged && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  store.splitBill(check.id)
                  store.pushToast({ tone: 'ok', text: t('billSplit'), actions: [] })
                }}
              >
                <Icon name="unlink" size={16} />
                {t('splitBack')}
              </button>
            )}
            {check.status === 'open' ? (
              <button type="button" className="btn" onClick={() => A.requestBill(check.id)} disabled={!check.lines.length}>
                <Icon name="calendar" size={16} />
                {t('requestBill')}
              </button>
            ) : null}
            <button
              type="button"
              className="btn ok wide"
              onClick={() => {
                A.payAndClose(check.id)
                store.pushToast({ tone: 'ok', text: t('paid'), actions: [{ label: t('undo'), run: store.undo }] })
              }}
              disabled={!check.lines.length}
            >
              <Icon name="check" size={16} />
              {t('payClose')} · {formatMoney(checkTotal(check), lang)}
            </button>
          </section>
        </>
      )}
    </div>
  )
}
