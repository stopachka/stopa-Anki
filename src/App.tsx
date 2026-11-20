import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { State, type Grade } from 'ts-fsrs';
import type { Book, Word } from './types';
import { grades, intervalLabel, nextWord, summarizeWords, type Memories, type Scheduler, type WordCounts } from './lib/scheduler';
import { db } from './lib/db';
import { useProgress } from './lib/progress';
import { WritingPad } from './components/WritingPad';
import { Pronunciation } from './components/Pronunciation';

type AppProps = { books: Book[]; words: Word[]; scheduler: Scheduler; user: { id: string; email?: string | null } };

function StudyCounts({ counts, className = '', compact = false }: { counts: WordCounts; className?: string; compact?: boolean }) {
  return <span className={`study-counts ${className}`}>
    <span className="count-new"><strong>{counts.newCount.toLocaleString()}</strong><span className={compact ? 'sr-only' : undefined}>New</span></span>
    <span className="count-learning"><strong>{counts.learningCount.toLocaleString()}</strong><span className={compact ? 'sr-only' : undefined}>Learning</span></span>
    <span className="count-review"><strong>{counts.reviewCount.toLocaleString()}</strong><span className={compact ? 'sr-only' : undefined}>Review</span></span>
  </span>;
}

function About({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="about-dialog" aria-labelledby="about-title" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="dialog-heading"><h2 id="about-title">About stopa-Anki</h2><button className="icon-button" aria-label="Close about" onClick={onClose}><X size={20} /></button></div>
    <p>Tap a word to reveal its pinyin and meaning. Draw in the space below it, or follow the faint stroke guide.</p>
    <p>The review buttons rate your recall of the word’s meaning. Drawing is optional practice and isn’t automatically graded.</p>
    <p>New counts unseen cards. Learning includes cards waiting for another learning step. Review counts review cards due now.</p>
    <div className="about-note"><strong>Saved to your account</strong><p>Your review history and next review dates sync when you’re signed in.</p></div>
    <p className="source-note">Vocabulary comes from Olle Linge’s Practical Audio-Visual Chinese lists, Books 1–3. Pronunciation audio is AI-generated with OpenAI. Stroke guides use Hanzi Writer; some stroke conventions may differ from Taiwan’s standards.</p>
    <div className="source-links"><a href="/data/README.md" target="_blank" rel="noreferrer">Vocabulary sources</a><a href="/hanzi/README.md" target="_blank" rel="noreferrer">Stroke data</a></div>
  </dialog>;
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
  const wordButton = useRef<HTMLButtonElement>(null);
  // Keep this presentation's scheduling input stable while Instant updates optimistically.
  const [card] = useState(() => memory ?? scheduler.newCard({ cardId: word.id, now: enteredAt }));
  const predictions = useMemo(() => grades.map(({ rating, label }) => ({ rating, label, interval: intervalLabel(scheduler.review({ card, grade: rating, now: previewAt }).card.dueAt, previewAt) })), [card, previewAt, scheduler]);
  useEffect(() => { wordButton.current?.focus({ preventScroll: true }); }, []);
  const flip = () => { if (saving || pending) return; if (!revealed) setPreviewAt(new Date()); setRevealed(value => !value); };
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
    <div className="study-content always-writing">
      <div className="word-stage">
        <div className="word-context"><span>Chapter {word.chapter}</span><span className="context-separator">·</span><span>{card.state === State.New ? 'New' : card.state === State.Review ? 'Review' : 'Learning'}</span></div>
        <h1 className="word-heading"><button ref={wordButton} disabled={saving || pending} className={`word-flip hanzi-word ${word.traditional.length > 4 ? 'long-word' : ''}`} aria-label={`${revealed ? 'Hide answer' : 'Reveal answer'} for ${word.traditional}`} aria-expanded={revealed} aria-controls="word-answer" onClick={flip}><span lang="zh-Hant">{word.traditional}</span></button></h1>
        <div className="word-tools"><Pronunciation word={word} /></div>
      </div>
      <WritingPad word={word.traditional} />
      <div id="word-answer" className={`answer ${revealed ? 'is-revealed' : ''}`} aria-live="polite">
        {revealed && <button className="answer-flip" disabled={saving || pending} onClick={flip} aria-label="Hide answer"><span className="pinyin">{word.pinyin}</span><span className="meaning">{word.english}</span></button>}
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
  const { memories, isLoading, error, saving, syncPending, saveReview } = useProgress({ userId: user.id });
  const [reviewTurn, setReviewTurn] = useState(0);
  const [about, setAbout] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const scope = useMemo(() => words.filter(word => word.book === selectedBook?.book), [words, selectedBook]);
  const current = scope.find(word => word.id === currentId);
  const counts = summarizeWords(scope, memories, clock);
  const nextDue = scope.map(word => memories[word.id]?.dueAt).filter((date): date is Date => !!date).sort((a, b) => a.getTime() - b.getTime())[0];

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 5000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!isLoading && !error && !saving && selectedBook && !current) {
      const next = nextWord(scope, memories, clock);
      if (next) setCurrentId(next.id);
    }
  }, [clock, scope, memories, selectedBook, current, isLoading, error, saving]);

  const begin = (book: Book) => {
    if (saving || isLoading || error) return;
    const selection = words.filter(word => word.book === book.book);
    setSelectedBook(book);
    setCurrentId(nextWord(selection, memories, new Date())?.id ?? null);
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
    setCurrentId(nextWord(scope, updated, new Date())?.id ?? null);
    setReviewTurn(turn => turn + 1);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const signOut = async () => {
    if (saving || signingOut) return;
    setSigningOut(true);
    setAccountError('');
    try { await db.auth.signOut(); }
    catch { setAccountError('Couldn’t sign out. Try again.'); }
    finally { setSigningOut(false); }
  };

  return <div className={`app-shell ${selectedBook ? 'study-shell' : 'home-shell'}`}>
    <header className="app-header"><button className="brand" disabled={saving} onClick={closeBook} aria-label="stopa-Anki home"><span className="brand-mark" lang="zh-Hant">文</span><span>stopa-Anki</span></button><div className="header-actions">{syncPending && <span className="sync-status" role="status">Waiting to sync</span>}<button className="signout-button" disabled={saving || signingOut} onClick={() => { void signOut(); }}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div></header>
    {accountError && <p className="signout-error" role="alert">{accountError}</p>}
    {isLoading ? <main className="progress-gate" role="status">Loading your progress…</main> : error ? <main className="progress-gate" role="alert"><h1>Couldn’t load your progress.</h1><button className="primary-button" onClick={() => window.location.reload()}>Try again</button></main> : !selectedBook ? <main className="home-main">
      <section className="home-intro"><h1>Your books</h1></section>
      <div className="book-list">{books.map(book => {
        const bookWords = words.filter(word => word.book === book.book);
        const bookCounts = summarizeWords(bookWords, memories, clock);
        return <button className="book-card" disabled={saving} key={book.id} onClick={() => begin(book)} aria-label={`Study Book ${book.book}. ${bookCounts.total} total, ${bookCounts.newCount} new, ${bookCounts.learningCount} learning, ${bookCounts.reviewCount} reviews due.`}>
          <span className="book-topline"><span className="book-details"><span className="book-title">{book.title}</span><span className="book-total">{bookCounts.total.toLocaleString()} total</span></span></span>
          <span className="book-progress-track" role="progressbar" aria-label="Cards started" aria-valuemin={0} aria-valuemax={bookCounts.total} aria-valuenow={bookCounts.started} title={`${bookCounts.started} / ${bookCounts.total} cards started`}><span style={{ width: `${bookCounts.total ? (bookCounts.started / bookCounts.total) * 100 : 0}%` }} /></span>
          <StudyCounts counts={bookCounts} />
        </button>;
      })}</div>
      <div className="home-about"><button onClick={() => setAbout(true)}>About</button></div>
    </main> : <main className="study-main">
      <div className="study-heading"><button className="books-button" disabled={saving} onClick={closeBook} aria-label="Back to books" title="Back to books"><X size={18} aria-hidden="true" /></button><span className="study-book-title">{selectedBook.title}</span></div>
      <div className="session-progress"><div className="progress-track" role="progressbar" aria-label="Cards started" aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={counts.started}><span style={{ width: `${counts.total ? (counts.started / counts.total) * 100 : 0}%` }} /></div><span>{counts.started} / {counts.total}</span></div>
      {current ? <StudyCard key={`${current.id}-${reviewTurn}`} word={current} memory={memories[current.id]} scheduler={scheduler} counts={counts} saving={saving} onGrade={grade} /> : <><div className="complete-state"><span className="complete-icon"><Check size={26} strokeWidth={1.6} /></span><h1>Caught up</h1>{nextDue && <p className="next-review">Next review · {intervalLabel(nextDue, clock)}</p>}<button className="primary-button" disabled={saving} onClick={closeBook}>Your books</button></div><footer className="review-footer complete-footer"><StudyCounts counts={counts} className="footer-counts" compact /></footer></>}
    </main>}
    {about && <About onClose={() => setAbout(false)} />}
  </div>;
}
