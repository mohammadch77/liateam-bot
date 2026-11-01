'use client';

/** «انتخاب همه / هیچ‌کدام»: ticks every checkbox named `name` inside the form (the bulk edit of provinces). */
export function SelectAll({ formId, name }: { formId: string; name: string }) {
  const set = (on: boolean) =>
    document
      .getElementById(formId)
      ?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`)
      .forEach((c) => (c.checked = on));
  return (
    <span style={{ display: 'inline-flex', gap: 8 }}>
      <button type="button" onClick={() => set(true)} data-select-all style={btn}>
        انتخاب همه
      </button>
      <button type="button" onClick={() => set(false)} style={btn}>
        هیچ‌کدام
      </button>
    </span>
  );
}

const btn = {
  minHeight: 44,
  padding: '0 14px',
  border: '1px solid var(--color-line)',
  borderRadius: 12,
  background: 'var(--color-white)',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
} as const;
