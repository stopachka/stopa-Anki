import { createRoot } from 'react-dom/client';
import App from './App';
import { makeScheduler } from './lib/scheduler';
import { db } from './lib/db';
import { Login } from './components/Auth';
import type { Scheduler } from './lib/scheduler';
import type { Book, Word } from './types';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="loading-state"><span className="brand-mark" lang="zh-Hant">文</span></div>);

function AuthenticatedApp({ books, words, scheduler }: { books: Book[]; words: Word[]; scheduler: Scheduler }) {
  const { user, isLoading, error } = db.useAuth();
  if (isLoading) return <div className="loading-state" role="status" aria-label="Loading account"><span className="brand-mark" lang="zh-Hant">文</span></div>;
  if (error) return <div className="loading-state"><h1>Couldn’t load your account.</h1><button className="primary-button" onClick={() => window.location.reload()}>Try again</button></div>;
  if (!user) return <Login />;
  return <App key={user.id} books={books} words={words} scheduler={scheduler} user={user} />;
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Couldn’t load ${path}`);
  return response.json();
}

async function boot() {
  try {
    const [books, scheduler] = await Promise.all([readJson<Book[]>('/data/index.json'), makeScheduler()]);
    const data = await Promise.all(books.map(book => readJson<Word[]>(`/data/${book.file}`)));
    root.render(<AuthenticatedApp books={books} words={data.flat()} scheduler={scheduler} />);
  } catch (error) {
    console.error('Unable to open stopa-Anki', error);
    root.render(<div className="loading-state"><h1>Couldn’t open your books.</h1><p>Please check that the local app is running and try again.</p><button className="primary-button" onClick={() => window.location.reload()}>Try again</button></div>);
  }
}
void boot();
