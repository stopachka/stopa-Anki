import { useEffect, useRef, useState } from 'react';
import { Square, Volume2 } from 'lucide-react';
import type { Word } from '../types';

type Recording = { src: string; source: string; voice?: string };
type Manifest = Record<string, Recording>;
let manifest: Manifest = {};
let lastLoaded = 0;
let pending: Promise<Manifest> | null = null;

async function loadManifest() {
  if (Date.now() - lastLoaded < 5000) return manifest;
  if (pending) return pending;
  pending = fetch('/audio-openai/manifest.json', { cache: 'no-store' })
    .then(async response => {
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) return manifest;
      manifest = await response.json();
      lastLoaded = Date.now();
      return manifest;
    }).catch(() => manifest).finally(() => { pending = null; });
  return pending;
}

export function Pronunciation({ word }: { word: Word }) {
  const key = `${word.traditional}|${word.pinyin}`;
  const [recording, setRecording] = useState<Recording | undefined>(manifest[key]);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let disposed = false;
    const update = () => { void loadManifest().then(data => { if (!disposed) setRecording(data[key]); }); };
    setRecording(manifest[key]);
    setError('');
    setPlaying(false);
    update();
    const timer = window.setInterval(update, 10000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      if (audio.current) { audio.current.pause(); audio.current.onended = null; audio.current.onerror = null; audio.current = null; }
    };
  }, [key]);

  const play = async () => {
    if (!recording) return;
    if (playing && audio.current) { audio.current.pause(); audio.current.currentTime = 0; setPlaying(false); return; }
    setError('');
    const clip = new Audio(recording.src);
    audio.current = clip;
    clip.onended = () => { if (audio.current === clip) setPlaying(false); };
    clip.onerror = () => { if (audio.current === clip) { setPlaying(false); setError('Couldn’t play audio. Tap to try again.'); } };
    setPlaying(true);
    try { await clip.play(); }
    catch { if (audio.current === clip) { setPlaying(false); setError('Couldn’t play audio. Tap to try again.'); } }
  };

  return <div className="pronunciation-control">
    <button className="tool-button pronunciation-button" onClick={play} disabled={!recording} aria-label={playing ? 'Stop pronunciation' : `Listen to ${word.traditional}`} title={recording ? 'Mandarin pronunciation' : word.book === 1 ? 'Audio is being prepared' : 'Audio not added yet'}>
      {playing ? <Square size={16} /> : <Volume2 size={18} />}
    </button>
    {error && <span className="audio-error" role="status">{error}</span>}
  </div>;
}
