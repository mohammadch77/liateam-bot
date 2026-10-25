'use client';

import { useState } from 'react';
import { formatPriceInput, parsePrice } from '@/lib/price-range';
import s from './catalog.module.css';

/**
 * «محدوده قیمت» in the listing's GET form: two amount fields (min / max, Persian or Latin digits, thousands
 * separators shown) and a slider with two handles over the shop's lowest…highest final price. The fields are what
 * the form sends, so without JavaScript it is a plain form; with it, releasing a handle or leaving a changed field
 * applies the filter at once. The server parses the amounts again (src/lib/price-range.ts).
 */
export function PriceFilter({
  min,
  max,
  lo,
  hi,
}: {
  min?: number;
  max?: number;
  /** the shop's lowest / highest final price (toman) */
  lo: number;
  hi: number;
}) {
  const step = hi - lo > 2_000_000 ? 50_000 : 10_000;
  const floor = Math.floor(lo / step) * step;
  const ceil = Math.max(floor + step, Math.ceil(hi / step) * step);
  const [from, setFrom] = useState(min ?? floor);
  const [to, setTo] = useState(max ?? ceil);
  const [fromText, setFromText] = useState(formatPriceInput(min));
  const [toText, setToText] = useState(formatPriceInput(max));

  const submit = (el: HTMLElement) => el.closest('form')?.requestSubmit();
  const pct = (v: number) => ((v - floor) / (ceil - floor)) * 100;

  return (
    <fieldset className={s.fieldset} data-price-filter>
      <legend className={s.legend}>محدوده قیمت (تومان)</legend>
      <div className={s.priceInputs}>
        <label className={s.priceField}>
          <span>از</span>
          <input
            name="min"
            inputMode="numeric"
            autoComplete="off"
            placeholder={formatPriceInput(floor)}
            value={fromText}
            onChange={(e) => {
              setFromText(e.target.value);
              const n = parsePrice(e.target.value);
              if (n !== undefined) setFrom(Math.min(n, to));
            }}
            onBlur={(e) => {
              const n = parsePrice(e.target.value);
              setFromText(formatPriceInput(n));
              if (n !== min) submit(e.currentTarget);
            }}
            aria-label="حداقل قیمت به تومان"
          />
        </label>
        <label className={s.priceField}>
          <span>تا</span>
          <input
            name="max"
            inputMode="numeric"
            autoComplete="off"
            placeholder={formatPriceInput(ceil)}
            value={toText}
            onChange={(e) => {
              setToText(e.target.value);
              const n = parsePrice(e.target.value);
              if (n !== undefined) setTo(Math.max(n, from));
            }}
            onBlur={(e) => {
              const n = parsePrice(e.target.value);
              setToText(formatPriceInput(n));
              if (n !== max) submit(e.currentTarget);
            }}
            aria-label="حداکثر قیمت به تومان"
          />
        </label>
      </div>
      <div
        className={s.range}
        style={{ '--from': `${pct(from)}%`, '--to': `${pct(to)}%` } as React.CSSProperties}
      >
        <input
          type="range"
          min={floor}
          max={ceil}
          step={step}
          value={from}
          aria-label="حداقل قیمت"
          aria-valuetext={`${formatPriceInput(from)} تومان`}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), to);
            setFrom(v);
            setFromText(v <= floor ? '' : formatPriceInput(v));
          }}
          onPointerUp={(e) => submit(e.currentTarget)}
          onKeyUp={(e) => submit(e.currentTarget)}
        />
        <input
          type="range"
          min={floor}
          max={ceil}
          step={step}
          value={to}
          aria-label="حداکثر قیمت"
          aria-valuetext={`${formatPriceInput(to)} تومان`}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), from);
            setTo(v);
            setToText(v >= ceil ? '' : formatPriceInput(v));
          }}
          onPointerUp={(e) => submit(e.currentTarget)}
          onKeyUp={(e) => submit(e.currentTarget)}
        />
      </div>
    </fieldset>
  );
}
