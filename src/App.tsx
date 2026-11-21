import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Github, RefreshCw, Settings2 } from 'lucide-react';
import { State, type Grade } from './lib/anki/types';
import type { Book, Word } from './types';
import { grades, intervalLabel, type Memories, type Scheduler, type WordCounts } from './lib/scheduler';
import { RwkvStudyQueue, summarizeRwkvWords } from './lib/rwkv/queue';
import { useRwkv } from './lib/rwkv/use-rwkv';
import { db } from './lib/db';
import { useProgress } from './lib/progress';
import { useSettings } from './lib/settings';
import { remainingNewWords } from './lib/daily-limit';
import { WritingPad } from './components/WritingPad';
import { Pronunciation } from './components/Pronunciation';
import { Settings } from './components/Settings';

type ReviewTiming = { shownAt: number; durationMs: number };

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
  onGrade: (grade: Grade, timing: ReviewTiming) => Promise<void>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [enteredAt] = useState(() => new Date());
  const timing = useRef({ activeMs: 0, last: performance.now(), visible: document.visibilityState !== 'hidden' });
  const [saveError, setSaveError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const cardButton = useRef<HTMLButtonElement>(null);
  // Keep this presentation's scheduling input stable while Instant updates optimistically.
  const [card] = useState(() => memory ?? scheduler.newCard({ cardId: word.id, now: enteredAt }));
  useEffect(() => {
    const onVisibility = () => {
      const now = performance.now();
      if (timing.current.visible) timing.current.activeMs += Math.max(0, now - timing.current.last);
      timing.current.last = now;
      timing.current.visible = document.visibilityState !== 'hidden';
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  useEffect(() => { cardButton.current?.focus({ preventScroll: true }); }, []);
  const flip = () => {
    if (saving || pending) return;
    setRevealed(value => !value);
    cardButton.current?.focus({ preventScroll: true });
  };
  const submit = async (grade: Grade) => {
    if (submitting.current || saving) return;
    submitting.current = true;
    setPending(true);
    setSaveError('');
    const activeMs = timing.current.activeMs + (timing.current.visible ? Math.max(0, performance.now() - timing.current.last) : 0);
    try { await onGrade(grade, { shownAt: enteredAt.getTime(), durationMs: Math.min(60_000, Math.round(activeMs)) }); }
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
        <div className="card-writing" hidden={revealed}><WritingPad word={word.traditional} active={!revealed} /></div>
      </div>
    </div>
    <footer className="review-footer" aria-busy={saving || pending}>
      <div className="rating-slot">{revealed && <div className="rating-buttons" aria-label="Rate your recall">{grades.map(({ rating, label }) => <button key={rating} className={`rating-button rating-${label.toLowerCase()}`} disabled={saving || pending} onClick={() => { void submit(rating); }}><span>{label}</span></button>)}</div>}</div>
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
  const { memories, reviews, introductions, isLoading: progressLoading, error: progressError, saving, syncPending, saveReview } = useProgress({ userId: user.id, now: clock });
  const settings = useSettings({ userId: user.id });
  const rwkv = useRwkv({ userId: user.id, words, reviews, memories, enabled: !progressLoading && !progressError });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isLoading = progressLoading || settings.isLoading;
  const error = progressError || settings.error;
  const remainingNew = remainingNewWords(settings.dailyNewLimit, introductions);
  const [reviewTurn, setReviewTurn] = useState(0);
  const [advancingReviewId, setAdvancingReviewId] = useState<string | null>(null);
  const reviewBusy = saving || advancingReviewId !== null;
  const studyQueue = useRef(new RwkvStudyQueue());
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState('');
  const scope = useMemo(() => words.filter(word => word.book === selectedBook?.book), [words, selectedBook]);
  const current = scope.find(word => word.id === currentId);
  const lastCounts = useRef<WordCounts | null>(null);
  const counts = rwkv.isReady ? summarizeRwkvWords(scope, memories, clock, rwkv.scores, remainingNew)
    : lastCounts.current ?? { total: scope.length, started: 0, newCount: 0, learningCount: 0, reviewCount: 0 };
  if (rwkv.isReady) lastCounts.current = counts;
  const unseen = scope.some(word => !memories[word.id]);
  const dailyLimitReached = remainingNew === 0 && unseen;
  const nextDue = scope.map(word => memories[word.id]).filter(card => card && (card.state === State.Learning || card.state === State.Relearning)).map(card => card.dueAt).filter((date): date is Date => !!date && date > clock).sort((a, b) => a.getTime() - b.getTime())[0];

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 5000); return () => window.clearInterval(timer); }, []);
  useLayoutEffect(() => {
    if (isLoading || error || !rwkv.isReady || saving || !selectedBook) return;
    if (advancingReviewId) {
      // Keep the answered card on screen until this exact saved event has been
      // incorporated into the model. Resolve the next card before painting an
      // empty state, so "Caught up" only appears for a genuinely empty queue.
      if (!reviews.some(review => review.id === advancingReviewId)) return;
      const now = new Date();
      const next = studyQueue.current.next(scope, memories, now, rwkv.scores, remainingNew);
      setCurrentId(next?.id ?? null);
      setReviewTurn(turn => turn + 1);
      setAdvancingReviewId(null);
      setClock(now);
    } else if (!current) {
      const next = studyQueue.current.next(scope, memories, clock, rwkv.scores, remainingNew);
      if (next) setCurrentId(next.id);
    }
  }, [clock, scope, memories, reviews, selectedBook, current, isLoading, error, saving, remainingNew, rwkv.isReady, rwkv.scores, advancingReviewId]);

  // A different device may use the shared allowance while this card is open.
  useEffect(() => {
    if (!reviewBusy && !isLoading && current && !memories[current.id] && remainingNew === 0) {
      setCurrentId(rwkv.isReady ? studyQueue.current.next(scope, memories, clock, rwkv.scores, 0)?.id ?? null : null);
    }
  }, [reviewBusy, isLoading, current, memories, remainingNew, scope, clock, rwkv.isReady, rwkv.scores]);

  const begin = (book: Book) => {
    if (reviewBusy || settings.saving || isLoading || error || !rwkv.isReady) return;
    const selection = words.filter(word => word.book === book.book);
    studyQueue.current.reset();
    setSelectedBook(book);
    setCurrentId(studyQueue.current.next(selection, memories, new Date(), rwkv.scores, remainingNew)?.id ?? null);
    window.scrollTo({ top: 0 });
  };
  const closeBook = () => { if (reviewBusy) return; studyQueue.current.reset(); setSelectedBook(null); setCurrentId(null); window.scrollTo({ top: 0 }); };
  const grade = async (rating: Grade, timing: ReviewTiming) => {
    if (!current || reviewBusy) return;
    const now = new Date();
    const card = memories[current.id] ?? scheduler.newCard({ cardId: current.id, now });
    const result = scheduler.review({ card, grade: rating, now });
    const updated = { ...memories, [current.id]: result.card };
    const saved = await saveReview(current, result.card, { ...result.revlog, shownAt: Math.min(timing.shownAt, now.getTime()), durationMs: timing.durationMs });
    const updatedIntroductions = new Set(introductions);
    if (card.state === State.New) updatedIntroductions.add(current.id);
    const availableNew = remainingNewWords(settings.dailyNewLimit, updatedIntroductions);
    const queuedAt = new Date();
    studyQueue.current.answer(current.id, updated, scope, queuedAt, rwkv.scores, availableNew);
    setAdvancingReviewId(saved.id);
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
    {isLoading ? <main className="progress-gate" role="status">Loading your progress…</main> : error ? <main className="progress-gate" role="alert"><h1>Couldn’t load your progress.</h1><button className="primary-button" onClick={() => window.location.reload()}>Try again</button></main> : rwkv.error ? <main className="progress-gate" role="alert"><h1>Couldn’t prepare your reviews.</h1><p>Your saved progress is safe.</p><button className="primary-button" onClick={rwkv.retry}>Try again</button></main> : rwkv.isLoading && !current ? <main className="progress-gate" role="status">Preparing your reviews…</main> : !selectedBook ? <main className="home-main">
      <section className="home-intro"><h1>Your books</h1></section>
      <div className="book-list">{books.map(book => {
        const bookWords = words.filter(word => word.book === book.book);
        const bookCounts = summarizeRwkvWords(bookWords, memories, clock, rwkv.scores, remainingNew);
        return <button className="book-card" disabled={saving || !rwkv.isReady} key={book.id} onClick={() => begin(book)} aria-label={`Study Book ${book.book}. ${bookCounts.total} total, ${bookCounts.newCount} new, ${bookCounts.learningCount} learning, ${bookCounts.reviewCount} reviews due.`}>
          <span className="book-topline"><span className="book-details"><span className="book-title">{book.title}</span><span className="book-total">{bookCounts.total.toLocaleString()} total</span></span></span>
          <span className="book-progress-track" role="progressbar" aria-label="Cards started" aria-valuemin={0} aria-valuemax={bookCounts.total} aria-valuenow={bookCounts.started} title={`${bookCounts.started} / ${bookCounts.total} cards started`}><span style={{ width: `${bookCounts.total ? (bookCounts.started / bookCounts.total) * 100 : 0}%` }} /></span>
          <StudyCounts counts={bookCounts} />
        </button>;
      })}</div>
      <div className="home-tools"><button className="home-refresh" disabled={saving || settings.saving || signingOut} aria-label="Refresh app" title="Refresh app" onClick={() => window.location.reload()}><RefreshCw size={16} aria-hidden="true" /></button><button className="home-settings" disabled={saving || signingOut} aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} aria-hidden="true" /></button><a className="home-source" href="https://github.com/stopachka/stopa-Anki" target="_blank" rel="noreferrer" aria-label="Source code" title="Source code"><Github size={16} aria-hidden="true" /></a></div>
      <p className="algorithm-label">RWKV-Instant · Big</p>
    </main> : <main className="study-main">
      <div className="study-heading"><button className="books-button" disabled={reviewBusy} onClick={closeBook} aria-label="Back to books" title="Back to books"><ArrowLeft size={20} aria-hidden="true" /></button><span className="study-book-title">{selectedBook.title}</span></div>
      <div className="session-progress"><div className="progress-track" role="progressbar" aria-label="Cards started" aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.started}><span style={{ width: `${counts.total ? (counts.started / counts.total) * 100 : 0}%` }} /></div><span>{counts.started} / {counts.total}</span></div>
      {current ? <StudyCard key={`${current.id}-${reviewTurn}`} word={current} memory={memories[current.id]} scheduler={scheduler} counts={counts} saving={reviewBusy} onGrade={grade} /> : <><div className="complete-state"><span className="complete-icon"><Check size={26} strokeWidth={1.6} /></span><h1>{dailyLimitReached ? 'Done for today' : 'Caught up'}</h1>{dailyLimitReached && <p>{settings.dailyNewLimit === 0 ? 'New words paused.' : 'New words tomorrow.'}</p>}{nextDue && <p className="next-review">Next review · {intervalLabel(nextDue, clock)}</p>}<button className="primary-button" disabled={reviewBusy} onClick={closeBook}>Your books</button></div><footer className="review-footer complete-footer"><StudyCounts counts={counts} className="footer-counts" compact /></footer></>}
    </main>}
    <Settings open={settingsOpen} value={settings.dailyNewLimit} saving={settings.saving} onSave={settings.saveDailyNewLimit} onClose={() => setSettingsOpen(false)} />
  </div>;
}
