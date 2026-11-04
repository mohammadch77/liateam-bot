/**
 * The affiliate's reports, pure: the last twelve months of commission grouped by PERSIAN month (the shop's calendar), the CSV of
 * the commissions, and the display rules for the people in the network. No database, no clock but the one passed in.
 */
export type DayTotal = { day: string; total: number; paid: number };
export type MonthTotal = { key: string; label: string; total: number; paid: number };

const MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];
const FA = '۰۱۲۳۴۵۶۷۸۹';
const faDigits = (n: number) => String(n).replace(/\d/g, (d) => FA[Number(d)]!);

const parts = new Intl.DateTimeFormat('en-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** the Persian (year, month 1..12) of a Gregorian instant, on the Tehran calendar */
export function persianYearMonth(at: Date): { y: number; m: number } {
  const get = (t: string) => Number(parts.formatToParts(at).find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month') };
}

/** «2026-03-05» (a Tehran calendar day) → its Persian month */
export function persianMonthOfDay(day: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return persianYearMonth(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)));
}

const keyOf = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

/** Exactly `months` entries, oldest first, the current Persian month last; a month without commission is zero. */
export function monthlyTotals(days: readonly DayTotal[], now: Date, months = 12): MonthTotal[] {
  const cur = persianYearMonth(now);
  const out: MonthTotal[] = [];
  let { y, m } = cur;
  for (let i = 0; i < months; i++) {
    out.unshift({ key: keyOf(y, m), label: `${MONTHS[m - 1]} ${faDigits(y)}`, total: 0, paid: 0 });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const byKey = new Map(out.map((r) => [r.key, r]));
  for (const d of days) {
    const pm = persianMonthOfDay(d.day);
    const row = pm ? byKey.get(keyOf(pm.y, pm.m)) : undefined;
    if (row) {
      row.total += d.total;
      row.paid += d.paid;
    }
  }
  return out;
}

/** the earliest Gregorian instant the twelve months can start at (a bit early; the grouping drops what is outside) */
export const reportSince = (now: Date, months = 12): Date => new Date(now.getTime() - (months * 31 + 3) * 86_400_000);

/** a first name for the network list: the first word, short, or a neutral word; never anything else of the person */
export function networkName(first: string | null | undefined): string {
  const t = (first ?? '').trim().split(/\s+/)[0] ?? '';
  return t ? t.slice(0, 30) : 'کاربر';
}

/** «••••1234» from the last four digits only */
export const maskedPhone = (last4: string): string => `••••${/^\d{4}$/.test(last4) ? last4 : '••••'}`;

export type CsvCommission = {
  id: string;
  level: number;
  status: string;
  base_amount: number;
  amount: number;
  created_at: Date;
  release_at: Date | null;
  paid_at: Date | null;
};

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d) : '');

/**
 * The CSV of an affiliate's commissions (UTF-8 with a BOM so a spreadsheet reads it). Only numbers, fixed words and dates: no customer
 * text, no order number, so nothing in it needs escaping or can start a formula.
 */
export function commissionsCsv(rows: readonly CsvCommission[]): string {
  const head = 'id,created,level,status,base_amount_toman,commission_toman,release_date,paid_date';
  const lines = rows.map((r) =>
    [r.id, day(r.created_at), r.level, r.status, r.base_amount, r.amount, day(r.release_at), day(r.paid_at)].join(','),
  );
  return `﻿${[head, ...lines].join('\r\n')}\r\n`;
}

// ── the referred person's orders and the reports made from them ──

export type PersonOrder = {
  order_number: string;
  paid_at: Date;
  order_status: string;
  base_amount: number | null;
  items_total: number;
  commission: number | null;
  commission_status: string | null;
  rule_kind: 'percent' | 'fixed' | null;
  rule_value: number | null;
};

/** «AV-••0001»: the order number with its middle hidden (a short code the affiliate can recognise, not the whole number) */
export const maskOrderNumber = (n: string): string => {
  const m = /^(AV-)(\d+)$/.exec(n);
  return m ? `${m[1]}••${m[2]!.slice(-4)}` : '••••';
};

const trim = (v: number) => String(Number(v.toFixed(4)));

/** the rule that was applied to an order: «۵٪» or «۲۰٬۰۰۰ تومان ثابت»; empty when no commission was made */
export function ruleLabel(kind: 'percent' | 'fixed' | null, value: number | null): string {
  if (!kind || value === null) return '—';
  return kind === 'percent' ? `${trim(value)}٪` : `${Math.floor(value).toLocaleString('en-US')} تومان (ثابت)`;
}

export const COMMISSION_STATUS_LABEL: Record<string, string> = {
  pending: 'در انتظار',
  approved: 'تأیید شد',
  paid: 'واریز شد',
  cancelled: 'لغو شد',
};

/** the totals above a person's orders: how many orders, the goods base they add up to, the commission (cancelled ones left out) */
export function personTotals(rows: readonly PersonOrder[]): { orders: number; base: number; commission: number } {
  let base = 0;
  let commission = 0;
  for (const r of rows) {
    base += r.base_amount ?? r.items_total;
    if (r.commission !== null && r.commission_status !== 'cancelled') commission += r.commission;
  }
  return { orders: rows.length, base, commission };
}

const jalali = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', dateStyle: 'medium' });

export type ReportTable = { title: string; sheet: string; headers: string[]; rows: Array<Array<string | number>> };

/** the table of a referred person's orders (Excel and the print page both read this one shape) */
export function personTable(
  person: string,
  rows: readonly PersonOrder[],
  statusLabel: (s: string) => string,
): ReportTable {
  return {
    title: `سفارش‌های ${person}`,
    sheet: 'سفارش‌ها',
    headers: ['تاریخ پرداخت', 'شماره‌ی سفارش', 'مبلغ سفارش پایه (تومان)', 'وضعیت سفارش', 'درصد یا مبلغ پورسانت', 'پورسانت (تومان)', 'وضعیت پورسانت'],
    rows: rows.map((r) => [
      jalali.format(r.paid_at),
      maskOrderNumber(r.order_number),
      r.base_amount ?? r.items_total,
      statusLabel(r.order_status),
      ruleLabel(r.rule_kind, r.rule_value),
      r.commission ?? 0,
      r.commission_status ? (COMMISSION_STATUS_LABEL[r.commission_status] ?? r.commission_status) : '—',
    ]),
  };
}

/** the table of an affiliate's commissions (Excel and the print page) */
export type CommissionExportRow = CsvCommission & { rule_kind: 'percent' | 'fixed' | null; rule_value: number | null };
export function commissionsTable(list: readonly CommissionExportRow[]): ReportTable {
  return {
    title: 'پورسانت‌ها',
    sheet: 'پورسانت‌ها',
    headers: ['تاریخ', 'مبلغ سفارش پایه (تومان)', 'درصد یا مبلغ پورسانت', 'پورسانت (تومان)', 'وضعیت', 'تاریخ آزادسازی', 'تاریخ واریز'],
    rows: list.map((r) => [
      jalali.format(r.created_at),
      r.base_amount,
      ruleLabel(r.rule_kind, r.rule_value),
      r.amount,
      COMMISSION_STATUS_LABEL[r.status] ?? r.status,
      r.release_at ? jalali.format(r.release_at) : '—',
      r.paid_at ? jalali.format(r.paid_at) : '—',
    ]),
  };
}
