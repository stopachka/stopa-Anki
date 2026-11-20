import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { db } from '../lib/db';
import './auth.css';

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'body' in error) {
    const body = error.body;
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
      return body.message;
    }
  }
  return fallback;
}

export function Login({ onCancel }: { onCancel?: () => void }) {
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | 'resend' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const requestInFlight = useRef(false);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const secondsLeft = Math.max(0, Math.ceil((resendAt - clock) / 1000));

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    input.current?.focus();
  }, [sentEmail]);

  useEffect(() => {
    if (!resendAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  async function sendCode(event?: FormEvent<HTMLFormElement>, resend = false) {
    event?.preventDefault();
    if (requestInFlight.current || (resend && secondsLeft > 0)) return;
    const address = (resend ? sentEmail : email).trim();
    if (!address) return;
    requestInFlight.current = true;
    setBusy(resend ? 'resend' : 'send');
    setError('');
    setNotice('');
    try {
      await db.auth.sendMagicCode({ email: address });
      if (!mounted.current) return;
      setSentEmail(address);
      setCode('');
      setClock(Date.now());
      setResendAt(Date.now() + 60_000);
      if (resend) {
        setNotice('Code sent');
        input.current?.focus();
      }
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, 'Couldn’t send a code. Try again.'));
    } finally {
      requestInFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current || !code.trim()) return;
    requestInFlight.current = true;
    setBusy('verify');
    setError('');
    setNotice('');
    try {
      await db.auth.signInWithMagicCode({ email: sentEmail, code: code.replace(/\s/g, '') });
    } catch (err) {
      if (mounted.current) {
        setError(errorMessage(err, 'That code didn’t work. Check it and try again.'));
        input.current?.focus();
        input.current?.select();
      }
    } finally {
      requestInFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  function changeEmail() {
    if (requestInFlight.current) return;
    setSentEmail('');
    setCode('');
    setError('');
    setNotice('');
    setResendAt(0);
  }

  return <div className="app-shell auth-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" lang="zh-Hant">文</span><span>stopa-Anki</span></div>
      {onCancel && <button className="icon-button" type="button" aria-label="Close login" onClick={onCancel} disabled={busy !== null}><X size={20} /></button>}
    </header>
    <main className="auth-main">
      <section className="auth-panel" aria-labelledby="auth-title">
        <h1 id="auth-title">{sentEmail ? 'Enter code' : 'Log in'}</h1>
        {sentEmail && <p className="auth-email">{sentEmail}</p>}
        <form key={sentEmail ? 'code' : 'email'} onSubmit={sentEmail ? verifyCode : sendCode} aria-busy={busy !== null}>
          <label className="auth-label" htmlFor="auth-input">{sentEmail ? 'Email code' : 'Email'}</label>
          <input
            ref={input}
            id="auth-input"
            className={sentEmail ? 'auth-input auth-code' : 'auth-input'}
            name={sentEmail ? 'code' : 'email'}
            type={sentEmail ? 'text' : 'email'}
            inputMode={sentEmail ? 'numeric' : 'email'}
            autoComplete={sentEmail ? 'one-time-code' : 'email'}
            autoCapitalize="none"
            spellCheck={false}
            placeholder={sentEmail ? '000000' : 'you@example.com'}
            value={sentEmail ? code : email}
            onChange={event => { sentEmail ? setCode(event.target.value) : setEmail(event.target.value); setError(''); setNotice(''); }}
            readOnly={busy !== null}
            aria-describedby={error ? 'auth-error' : undefined}
            aria-invalid={!!error}
            required
          />
          <div className="auth-feedback">
            {error ? <p id="auth-error" className="auth-error" role="alert">{error}</p> : notice ? <p className="auth-notice" role="status">{notice}</p> : null}
          </div>
          <button className="primary-button auth-submit" type="submit" disabled={busy !== null || !(sentEmail ? code.trim() : email.trim())}>
            {busy === 'send' ? 'Sending…' : busy === 'verify' ? 'Logging in…' : sentEmail ? 'Continue' : 'Send code'}
          </button>
        </form>
        {sentEmail && <div className="auth-secondary">
          <button type="button" onClick={changeEmail} disabled={busy !== null}>Use another email</button>
          <button type="button" onClick={() => void sendCode(undefined, true)} disabled={busy !== null || secondsLeft > 0}>
            {busy === 'resend' ? 'Sending…' : secondsLeft > 0 ? `Resend code (${secondsLeft}s)` : 'Resend code'}
          </button>
        </div>}
      </section>
    </main>
  </div>;
}
