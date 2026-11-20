import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, RefreshCw, Settings2 } from 'lucide-react';
import { State, type Grade } from 'ts-fsrs';
import type { Book, Word } from './types';
import { grades, intervalLabel, nextWord, summarizeWords, type Memories, type Scheduler, type WordCounts } from './lib/scheduler';
import { db } from './lib/db';
import { useProgress } from './lib/progress';
import { useSettings } from './lib/settings';
import { remainingNewWords } from './lib/daily-limit';
import { WritingPad } from './components/WritingPad';
import { Pronunciation } from './components/Pronunciation';
import { Settings } from './components/Settings';

type AppProps = { books: Book[]; words: Word[]; scheduler: Scheduler; user: { id: string; email?: string | null } };

function StudyCounts({ counts, className = '', compact = false }: { counts: WordCounts; className?: string; compact?: boolean }) {
  return <span className={`study-counts ${className}`}>
    <span className="count-new"><strong>{counts.newCount.toLocaleString()}</strong><span className={compact ? 'sr-only' : undefined}>New</span></span>
    <span className="count-learning"><strong>{counts.learningCount.toLocaleString()}</strong><span className={compact ? 'sr-only' : undefined}>Learning</span></span>
    <span className="count-review"><strong>{counts.reviewCount.toLocaleString()}</strong><span className={compact ? 'sr-only' : undefined}>Review</span></span>
  </span>;
}

function StudyCard({ word, memory, scheduler, counts, saving, onGrade }: {
  word: Word;
  memory: Memories[string] | undefined;
  scheduler: Scheduler;
  counts: WordCounts;
  saving: boolean;
  onGrade: (grade: Grade) => Promise<void>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [enteredAt] = useState(() => new Date());
  const [previewAt, setPreviewAt] = useState(enteredAt);
  const [saveError, setSaveError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const cardButton = useRef<HTMLButtonElement>(null);
  // Keep this presentation's scheduling input stable while Instant updates optimistically.
  const [card] = useState(() => memory ?? scheduler.newCard({ cardId: word.id, now: enteredAt }));
  const predictions = useMemo(() => grades.map(({ rating, label }) => ({ rating, label, interval: intervalLabel(scheduler.review({ card, grade: rating, now: previewAt }).card.dueAt, previewAt) })), [card, previewAt, scheduler]);
  useEffect(() => { cardButton.current?.focus({ preventScroll: true }); }, []);
  const flip = () => {
    if (saving || pending) return;
    if (!revealed) setPreviewAt(new Date());
    setRevealed(value => !value);
    cardButton.current?.focus({ preventScroll: true });
  };
  const submit = async (grade: Grade) => {
    if (submitting.current || saving) return;
    submitting.current = true;
    setPending(true);
    setSaveError('');
    try { await onGrade(grade); }
    catch { setSaveError('Couldn’t save your review. Try again.'); }
    finally { submitting.current = false; setPending(false); }
  };

  return <>
    <button ref={cardButton} className="card-tap-target" disabled={saving || pending} aria-label={`${revealed ? 'Show question' : 'Reveal answer'} for ${word.traditional}`} aria-expanded={revealed} aria-controls="word-answer" onClick={flip} />
    <div className={`study-content flashcard ${revealed ? 'is-revealed' : ''}`}>
      <div className="card-face">
        <div className="word-context"><span>Chapter {word.chapter}</span><span className="context-separator">·</span><span>{card.state === State.New ? 'New' : card.state === State.Review ? 'Review' : 'Learning'}</span></div>
        <h1 className={`hanzi-word card-word ${word.traditional.length > 4 ? 'long-word' : ''}`} lang="zh-Hant">{word.traditional}</h1>
        <div id="word-answer" className="card-answer" hidden={!revealed} aria-live="polite" onClick={flip}>
          {revealed && <><p className="pinyin">{word.pinyin}</p><p className="meaning">{word.english}</p></>}
        </div>
        <div className="word-tools"><Pronunciation word={word} /></div>
        <div className="card-writing" hidden={revealed}><WritingPad word={word.traditional} active={!revealed} onTap={flip} /></div>
      </div>
    </div>
    <footer className="review-footer" aria-busy={saving || pending}>
      <div className="rating-slot">{revealed && <div className="rating-buttons" aria-label="Rate your recall">{predictions.map(({ rating, label, interval }) => <button key={rating} className={`rating-button rating-${label.toLowerCase()}`} disabled={saving || pending} onClick={() => { void submit(rating); }}><span>{label}</span><span className="rating-interval">{interval}</span></button>)}</div>}</div>
      {(saving || pending) && <span className="sr-only" role="status">Saving review</span>}
      {saveError && <p className="save-error" role="alert">{saveError}</p>}
      <StudyCounts counts={counts} className="footer-counts" compact />
    </footer>
  </>;
}

export default function App({ books, words, scheduler, user }: AppProps) {
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const { memories, introductions, isLoading: progressLoading, error: progressError, saving, syncPending, saveReview } = useProgress({ userId: user.id, now: clock });
  const settings = useSettings({ userId: user.id });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isLoading = progressLoading || settings.isLoading;
  const error = progressError || settings.error;
  const remainingNew = remainingNewWords(settings.dailyNewLimit, introductions);
  const [reviewTurn, setReviewTurn] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState('');
  const scope = useMemo(() => words.filter(word => word.book === selectedBook?.book), [words, selectedBook]);
  const current = scope.find(word => word.id === currentId);
  const counts = summarizeWords(scope, memories, clock, remainingNew);
  const unseen = scope.some(word => !memories[word.id]);
  const dailyLimitReached = remainingNew === 0 && unseen;
  const nextDue = scope.map(word => memories[word.id]?.dueAt).filter((date): date is Date => !!date).sort((a, b) => a.getTime() - b.getTime())[0];

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 5000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!isLoading && !error && !saving && selectedBook && !current) {
      const next = nextWord(scope, memories, clock, remainingNew);
      if (next) setCurrentId(next.id);
    }
  }, [clock, scope, memories, selectedBook, current, isLoading, error, saving, remainingNew]);

  // A different device may use the shared allowance while this card is open.
  useEffect(() => {
    if (!saving && !isLoading && current && !memories[current.id] && remainingNew === 0) {
      setCurrentId(nextWord(scope, memories, clock, 0)?.id ?? null);
    }
  }, [saving, isLoading, current, memories, remainingNew, scope, clock]);

  const begin = (book: Book) => {
    if (saving || settings.saving || isLoading || error) return;
    const selection = words.filter(word => word.book === book.book);
    setSelectedBook(book);
    setCurrentId(nextWord(selection, memories, new Date(), remainingNew)?.id ?? null);
    window.scrollTo({ top: 0 });
  };
  const closeBook = () => { if (saving) return; setSelectedBook(null); setCurrentId(null); window.scrollTo({ top: 0 }); };
  const grade = async (rating: Grade) => {
    if (!current || saving) return;
    const now = new Date();
    const card = memories[current.id] ?? scheduler.newCard({ cardId: current.id, now });
    const result = scheduler.review({ card, grade: rating, now });
    const updated = { ...memories, [current.id]: result.card };
    await saveReview(current, result.card, result.revlog);
    const updatedIntroductions = new Set(introductions);
    if (card.state === State.New) updatedIntroductions.add(current.id);
    setCurrentId(nextWord(scope, updated, new Date(), remainingNewWords(settings.dailyNewLimit, updatedIntroductions))?.id ?? null);
    setReviewTurn(turn => turn + 1);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const signOut = async () => {
    if (saving || settings.saving || signingOut) return;
    setSigningOut(true);
    setAccountError('');
    try { await db.auth.signOut(); }
    catch { setAccountError('Couldn’t sign out. Try again.'); }
    finally { setSigningOut(false); }
  };

  return <div className={`app-shell ${selectedBook ? 'study-shell' : 'home-shell'}`} onDragStart={selectedBook ? event => event.preventDefault() : undefined} onContextMenu={selectedBook ? event => event.preventDefault() : undefined}>
    {!selectedBook && <header className="app-header"><button className="brand" disabled={saving} onClick={closeBook} aria-label="stopa-Anki home"><span className="brand-mark" lang="zh-Hant">文</span><span>stopa-Anki</span></button><div className="header-actions">{(syncPending || settings.syncPending) && <span className="sync-status" role="status">Waiting to sync</span>}<button className="signout-button" disabled={saving || settings.saving || signingOut} onClick={() => { void signOut(); }}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div></header>}
    {!selectedBook && accountError && <p className="signout-error" role="alert">{accountError}</p>}
    {isLoading ? <main className="progress-gate" role="status">Loading your progress…</main> : error ? <main className="progress-gate" role="alert"><h1>Couldn’t load your progress.</h1><button className="primary-button" onClick={() => window.location.reload()}>Try again</button></main> : !selectedBook ? <main className="home-main">
      <section className="home-intro"><h1>Your books</h1></section>
      <div className="book-list">{books.map(book => {
        const bookWords = words.filter(word => word.book === book.book);
        const bookCounts = summarizeWords(bookWords, memories, clock, remainingNew);
        return <button className="book-card" disabled={saving} key={book.id} onClick={() => begin(book)} aria-label={`Study Book ${book.book}. ${bookCounts.total} total, ${bookCounts.newCount} new, ${bookCounts.learningCount} learning, ${bookCounts.reviewCount} reviews due.`}>
          <span className="book-topline"><span className="book-details"><span className="book-title">{book.title}</span><span className="book-total">{bookCounts.total.toLocaleString()} total</span></span></span>
          <span className="book-progress-track" role="progressbar" aria-label="Cards started" aria-valuemin={0} aria-valuemax={bookCounts.total} aria-valuenow={bookCounts.started} title={`${bookCounts.started} / ${bookCounts.total} cards started`}><span style={{ width: `${bookCounts.total ? (bookCounts.started / bookCounts.total) * 100 : 0}%` }} /></span>
          <StudyCounts counts={bookCounts} />
        </button>;
      })}</div>
      <div className="home-tools"><button className="home-refresh" disabled={saving || settings.saving || signingOut} aria-label="Refresh app" title="Refresh app" onClick={() => window.location.reload()}><RefreshCw size={16} aria-hidden="true" /></button><button className="home-settings" disabled={saving || signingOut} aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} aria-hidden="true" /></button></div>
    </main> : <main className="study-main">
      <div className="study-heading"><button className="books-button" disabled={saving} onClick={closeBook} aria-label="Back to books" title="Back to books"><ArrowLeft size={20} aria-hidden="true" /></button><span className="study-book-title">{selectedBook.title}</span></div>
      <div className="session-progress"><div className="progress-track" role="progressbar" aria-label="Cards started" aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.started}><span style={{ width: `${counts.total ? (counts.started / counts.total) * 100 : 0}%` }} /></div><span>{counts.started} / {counts.total}</span></div>
      {current ? <StudyCard key={`${current.id}-${reviewTurn}`} word={current} memory={memories[current.id]} scheduler={scheduler} counts={counts} saving={saving} onGrade={grade} /> : <><div className="complete-state"><span className="complete-icon"><Check size={26} strokeWidth={1.6} /></span><h1>{dailyLimitReached ? 'Done for today' : 'Caught up'}</h1>{dailyLimitReached && <p>{settings.dailyNewLimit === 0 ? 'New words paused.' : 'New words tomorrow.'}</p>}{nextDue && <p className="next-review">Next review · {intervalLabel(nextDue, clock)}</p>}<button className="primary-button" disabled={saving} onClick={closeBook}>Your books</button></div><footer className="review-footer complete-footer"><StudyCounts counts={counts} className="footer-counts" compact /></footer></>}
    </main>}
    <Settings open={settingsOpen} value={settings.dailyNewLimit} saving={settings.saving} onSave={settings.saveDailyNewLimit} onClose={() => setSettingsOpen(false)} />
  </div>;
}
