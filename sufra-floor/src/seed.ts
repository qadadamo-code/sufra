import type { Check, Decor, Layout, MenuItem, Reservation, Table, WaitEntry, DirtyMark } from './core/types'

export const MENU: MenuItem[] = [
  { id: 'koshari', name: { ar: 'كشري', en: 'Koshari' }, price: 6_500 },
  { id: 'kofta', name: { ar: 'كفتة مشوية', en: 'Grilled kofta' }, price: 18_500 },
  { id: 'fatta', name: { ar: 'فتة لحمة', en: 'Fatta' }, price: 14_000 },
  { id: 'mahshi', name: { ar: 'محشي مشكل', en: 'Mixed mahshi' }, price: 12_000 },
  { id: 'salad', name: { ar: 'سلطة بلدي', en: 'Baladi salad' }, price: 4_000 },
  { id: 'tea', name: { ar: 'شاي', en: 'Tea' }, price: 2_500 },
  { id: 'lemon', name: { ar: 'ليمون نعناع', en: 'Lemon mint' }, price: 4_500 },
  { id: 'kunafa', name: { ar: 'كنافة', en: 'Kunafa' }, price: 9_000 },
]

const t = (id: string, zoneId: string, shape: Table['shape'], x: number, y: number, w: number, h: number, rotation = 0): Table => ({
  id,
  label: id,
  zoneId,
  shape,
  x,
  y,
  w,
  h,
  rotation,
  seatsOverride: null,
})
const d = (id: string, zoneId: string, kind: Decor['kind'], x: number, y: number, w: number, h: number, rotation = 0): Decor => ({
  id,
  zoneId,
  kind,
  x,
  y,
  w,
  h,
  rotation,
})

export const SEED_LAYOUT: Layout = {
  zones: [
    { id: 'hall', name: { ar: 'الصالة', en: 'Main hall' }, width: 1200, height: 820 },
    { id: 'terrace', name: { ar: 'التراس', en: 'Terrace' }, width: 900, height: 560 },
  ],
  tables: [
    t('T1', 'hall', 'square', 150, 130, 70, 70),
    t('T2', 'hall', 'square', 310, 130, 70, 70),
    t('T3', 'hall', 'square', 470, 130, 70, 70),
    t('T4', 'hall', 'square', 630, 130, 70, 70),
    t('T5', 'hall', 'rect', 200, 340, 140, 80),
    t('T6', 'hall', 'rect', 340, 340, 140, 80),
    t('T7', 'hall', 'round', 620, 340, 90, 90),
    t('T8', 'hall', 'round', 800, 340, 90, 90),
    t('T9', 'hall', 'booth', 1100, 160, 160, 80, 90),
    t('T10', 'hall', 'booth', 1100, 380, 160, 80, 90),
    t('T11', 'hall', 'oval', 330, 590, 220, 110),
    t('T12', 'hall', 'rect', 620, 590, 120, 70),
    t('B1', 'hall', 'bar', 950, 660, 240, 50),
    t('P1', 'terrace', 'round', 140, 140, 70, 70),
    t('P2', 'terrace', 'round', 300, 140, 70, 70),
    t('P3', 'terrace', 'round', 460, 140, 70, 70),
    t('P4', 'terrace', 'square', 140, 380, 80, 80),
    t('P5', 'terrace', 'square', 280, 380, 80, 80),
    t('P6', 'terrace', 'rect', 620, 380, 180, 90),
  ],
  decor: [
    d('w1', 'hall', 'window', 470, 6, 760, 12),
    d('dr', 'hall', 'door', 70, 780, 110, 20),
    d('pl1', 'hall', 'pillar', 470, 470, 46, 46),
    d('ct', 'hall', 'counter', 950, 760, 340, 60),
    d('pt1', 'hall', 'plant', 1150, 770, 50, 50),
    d('pt2', 'hall', 'plant', 40, 40, 50, 50),
    d('wl', 'terrace', 'wall', 890, 280, 20, 560),
    d('pt3', 'terrace', 'plant', 820, 60, 60, 60),
    d('pt4', 'terrace', 'plant', 40, 520, 50, 50),
  ],
}

/** The demo night starts at 20:30. */
export const SEED_NOW = 20 * 60 + 30

const line = (id: string, itemId: string, qty: number, origin: string) => ({
  id,
  itemId,
  qty,
  unitPrice: MENU.find((m) => m.id === itemId)!.price,
  originTableId: origin,
})

export const SEED_CHECKS: Check[] = [
  {
    id: 'c-t2',
    tableIds: ['T2'],
    guests: 2,
    openedAt: SEED_NOW - 40,
    status: 'open',
    reservationId: null,
    lines: [line('l1', 'kofta', 1, 'T2'), line('l2', 'salad', 1, 'T2'), line('l3', 'lemon', 2, 'T2')],
  },
  {
    id: 'c-t5',
    tableIds: ['T5', 'T6'],
    guests: 9,
    openedAt: SEED_NOW - 30,
    status: 'open',
    reservationId: null,
    lines: [
      line('l4', 'fatta', 3, 'T5'),
      line('l5', 'koshari', 2, 'T5'),
      line('l6', 'mahshi', 2, 'T6'),
      line('l7', 'tea', 4, 'T6'),
    ],
  },
  {
    id: 'c-t7',
    tableIds: ['T7'],
    guests: 3,
    openedAt: SEED_NOW - 85,
    status: 'bill_requested',
    reservationId: null,
    lines: [line('l8', 'koshari', 3, 'T7'), line('l9', 'kunafa', 2, 'T7'), line('l10', 'tea', 3, 'T7')],
  },
  {
    id: 'c-t9',
    tableIds: ['T9'],
    guests: 4,
    openedAt: SEED_NOW - 50,
    status: 'open',
    reservationId: null,
    lines: [line('l11', 'kofta', 2, 'T9'), line('l12', 'fatta', 2, 'T9')],
  },
  {
    id: 'c-p1',
    tableIds: ['P1'],
    guests: 2,
    openedAt: SEED_NOW - 15,
    status: 'open',
    reservationId: null,
    lines: [line('l13', 'lemon', 2, 'P1')],
  },
]

const r = (p: Partial<Reservation> & Pick<Reservation, 'id' | 'name' | 'party' | 'start' | 'tableIds'>): Reservation => ({
  phone: '',
  duration: p.party <= 2 ? 75 : p.party <= 4 ? 90 : p.party <= 6 ? 105 : 120,
  status: 'confirmed',
  note: '',
  tags: [],
  ...p,
})

export const SEED_RESERVATIONS: Reservation[] = [
  r({ id: 'r1', name: 'يوسف منصور', phone: '0100 234 5678', party: 2, start: 20 * 60 + 5, tableIds: ['T1'], status: 'pending' }),
  r({ id: 'r2', name: 'منى حسن', phone: '0111 987 6543', party: 2, start: 20 * 60 + 50, tableIds: ['T3'], tags: ['quiet'] }),
  r({ id: 'r3', name: 'كريم عادل', phone: '0122 555 0199', party: 4, start: 21 * 60, tableIds: ['T9'] }),
  r({ id: 'r4', name: 'عائلة الشريف', phone: '0100 777 1122', party: 8, start: 21 * 60, tableIds: ['T11'], tags: ['birthday', 'kids'], note: 'تورتة من عندهم — شموع بعد الأكل' }),
  r({ id: 'r5', name: 'شركة نيو ويف', phone: '0155 300 4000', party: 10, start: 22 * 60, tableIds: ['T5', 'T6'], tags: ['vip'] }),
  r({ id: 'r6', name: 'سارة إبراهيم', phone: '0109 111 2233', party: 3, start: 21 * 60 + 30, tableIds: ['P2'], tags: ['smoking'] }),
  r({ id: 'r7', name: 'عمر الشاذلي', phone: '0128 444 9090', party: 2, start: 22 * 60 + 15, tableIds: ['T7'] }),
  r({ id: 'r8', name: 'ليلى فاروق', phone: '0114 202 3030', party: 5, start: 22 * 60 + 45, tableIds: ['T11'], status: 'pending' }),
  r({ id: 'r9', name: 'حازم رشدي', phone: '0100 808 7070', party: 6, start: 19 * 60, tableIds: ['T12'], status: 'done' }),
]

export const SEED_WAITLIST: WaitEntry[] = [
  { id: 'w1', name: 'أبو علي', phone: '0120 333 4455', party: 4, addedAt: SEED_NOW - 10 },
  { id: 'w2', name: 'نادين', phone: '', party: 2, addedAt: SEED_NOW - 3 },
]

export const SEED_DIRTY: DirtyMark[] = [{ tableId: 'T4', since: SEED_NOW - 4 }]
