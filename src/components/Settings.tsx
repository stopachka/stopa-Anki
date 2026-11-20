import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';

export function Settings({ open, value, saving, onSave, onClose }: {
  open: boolean;
  value: number;
  saving: boolean;
  onSave: (value: number) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const inFlight = useRef<Promise<boolean> | null>(null);
  useEffect(() => { setDraft(String(value)); }, [value, open]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);

  const save = (explicit?: number): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (saving) return Promise.resolve(false);
    const next = explicit ?? Number(draft);
    if ((explicit === undefined && draft.trim() === '') || !Number.isInteger(next) || next < 0 || next > 999) {
      setError('Choose a number from 0 to 999.');
      return Promise.resolve(false);
    }
    setError('');
    if (next === value) { setDraft(String(next)); return Promise.resolve(true); }
    const request = (async () => {
      try { await onSave(next); setDraft(String(next)); return true; }
      catch { setError('Couldn’t save. Try again.'); return false; }
      finally { inFlight.current = null; }
    })();
    inFlight.current = request;
    return request;
  };
  const close = async () => { if (await save()) onClose(); };
  const step = (amount: number) => {
    const number = Number(draft);
    const next = Math.max(0, Math.min(999, (Number.isFinite(number) ? Math.round(number) : value) + amount));
    setDraft(String(next));
    void save(next);
  };

  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); void close(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) void close(); } }}>
    <div className="dialog-heading"><h2 id="settings-title">Settings</h2><button className="icon-button" aria-label="Close settings" disabled={saving} onClick={() => { void close(); }}><X size={19} /></button></div>
    <div className="setting-row">
      <label htmlFor="daily-new-limit">New words per day</label>
      <div className="limit-stepper" aria-busy={saving}>
        <button aria-label="Fewer new words" disabled={saving || Number(draft) <= 0} onClick={() => step(-1)}><Minus size={16} /></button>
        <input id="daily-new-limit" type="number" inputMode="numeric" min="0" max="999" step="1" value={draft} disabled={saving} onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={event => { if (!event.relatedTarget?.closest('.limit-stepper, .dialog-heading')) void save(); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} />
        <button aria-label="More new words" disabled={saving || Number(draft) >= 999} onClick={() => step(1)}><Plus size={16} /></button>
      </div>
    </div>
    {error && <p className="settings-error" role="alert">{error}</p>}
  </dialog>;
}
