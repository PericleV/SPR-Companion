import { useState } from 'react';

// A number input that keeps what is being typed (e.g. “1e-” or an empty field) and reports only valid numbers.
// bare: the input alone (in a table cell; `label` for screen readers), `unit` after it.
export function NumberField({ label, value, onChange, min, max, title, bare, unit, className, disabled }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; title?: string; bare?: boolean; unit?: string; className?: string; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  // follow outside changes (another page, an optimizer result) unless the text already means this value
  if (value !== shown) {
    setShown(value);
    if (Number(text) !== value) setText(String(value));
  }
  const v = Number(text);
  const valid = (x: number, t: string) => t.trim() !== '' && Number.isFinite(x) && (min === undefined || x >= min) && (max === undefined || x <= max);
  const input = (
    <input
      type="text"
      inputMode="decimal"
      aria-label={bare ? label : undefined}
      title={bare ? title : undefined}
      className={`${valid(v, text) ? '' : 'bad'}${bare && className ? ` ${className}` : ''}`}
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const x = Number(e.target.value);
        if (valid(x, e.target.value)) {
          setShown(x);
          onChange(x);
        }
      }}
    />
  );
  if (bare)
    return unit ? (
      <span className="with-unit">
        {input}
        <span className="unit">{unit}</span>
      </span>
    ) : (
      input
    );
  return (
    <label title={title} className={`field${className ? ` ${className}` : ''}`}>
      <span className="field-label">{label}{unit ? ` [${unit}]` : ''}</span>
      {input}
    </label>
  );
}
