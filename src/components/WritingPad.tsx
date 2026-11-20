import { useEffect, useRef, useState, type PointerEvent } from 'react';
import HanziWriter from 'hanzi-writer';
import { Eraser, RotateCcw, Undo2 } from 'lucide-react';
import './writing.css';

type Point = { x: number; y: number };
type Stroke = Point[];
const SIZE = 300;
const pathOf = (points: Stroke) => points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');

export function WritingPad({ word, active = true }: { word: string; active?: boolean }) {
  const characters = Array.from(word);
  const [index, setIndex] = useState(0);
  const [drawings, setDrawings] = useState<Record<number, Stroke[]>>({});
  const [current, setCurrent] = useState<Stroke>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const target = useRef<HTMLDivElement>(null);
  const writer = useRef<HanziWriter | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePointer = useRef<number | null>(null);
  const currentRef = useRef<Stroke>([]);
  const character = characters[index];
  const strokes = drawings[index] ?? [];

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const controller = new AbortController();
    const mount = document.createElement('div');
    target.current!.appendChild(mount);
    const fitGuide = () => {
      const svg = mount.querySelector('svg');
      // Hanzi Writer emits width/height but no viewBox. CSS resizing alone clips
      // its 300px coordinate system instead of scaling it to the ink overlay.
      svg?.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
      svg?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    };
    setStatus('loading');
    const instance = HanziWriter.create(mount, character, {
      width: SIZE, height: SIZE, padding: 30,
      showCharacter: true, showOutline: true,
      strokeColor: '#c9c9c9', outlineColor: '#f1f1f1',
      strokeAnimationSpeed: 1.2, delayBetweenStrokes: 120,
      delayBetweenLoops: 1600,
      charDataLoader: async char => {
        const response = await fetch(`/hanzi/${encodeURIComponent(char)}.json`, { signal: controller.signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('No stroke data');
        return response.json();
      },
      onLoadCharDataSuccess: () => {
        if (disposed) return;
        setStatus('ready');
        requestAnimationFrame(() => { if (!disposed) fitGuide(); });
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          autoTimer.current = setTimeout(() => {
            autoTimer.current = null;
            if (!disposed) void instance.loopCharacterAnimation();
          }, 1000);
        }
      },
      onLoadCharDataError: () => { if (!disposed) setStatus('error'); },
    });
    fitGuide();
    writer.current = instance;
    return () => {
      disposed = true;
      if (autoTimer.current) clearTimeout(autoTimer.current);
      autoTimer.current = null;
      controller.abort();
      void instance.pauseAnimation();
      mount.remove();
      writer.current = null;
    };
  }, [character, index, active]);

  const replay = () => {
    if (!writer.current || status !== 'ready') return;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
    // Starting a loop replaces the current animation, including a paused loop.
    void writer.current.loopCharacterAnimation();
  };
  const position = (event: PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(SIZE, (event.clientX - rect.left) * SIZE / rect.width)), y: Math.max(0, Math.min(SIZE, (event.clientY - rect.top) * SIZE / rect.height)) };
  };
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    currentRef.current = [position(event)];
    setCurrent(currentRef.current);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== event.pointerId) return;
    currentRef.current = [...currentRef.current, position(event)];
    setCurrent(currentRef.current);
  };
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== event.pointerId) return;
    if (currentRef.current.length) {
      const stroke = currentRef.current;
      setDrawings(previous => ({ ...previous, [index]: [...(previous[index] ?? []), stroke] }));
    }
    activePointer.current = null;
    currentRef.current = [];
    setCurrent([]);
  };

  return <section className="practice-area" aria-label="Handwriting practice">
    <div className={`practice-surface ${strokes.length ? 'has-ink' : ''}`}>
      <div ref={target} className="practice-guide" aria-label={`Stroke order for ${character}`} />
      {status === 'error' && <span className="practice-fallback" lang="zh-Hant">{character}</span>}
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="practice-ink" role="img" aria-label={`Draw ${character} here with your finger, pen, or mouse`} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
        <g stroke="#eaeaea" strokeWidth="0.6" strokeDasharray="3 6"><path d="M150 0 V300 M0 150 H300" /></g>
        {[...strokes, current].filter(stroke => stroke.length).map((stroke, i) => stroke.length === 1 ? <circle key={i} cx={stroke[0].x} cy={stroke[0].y} r="2.6" fill="#252525" /> : <path key={i} d={pathOf(stroke)} fill="none" stroke="#252525" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
    </div>
    <div className="practice-bottom">
      <div className="practice-characters" aria-label="Choose a character">
        {characters.length > 1 && characters.map((char, i) => <button key={i} className={index === i ? 'selected' : ''} aria-label={`Practice ${char}, character ${i + 1}`} aria-pressed={index === i} onClick={() => setIndex(i)} lang="zh-Hant">{char}</button>)}
      </div>
      <div className="practice-controls">
        <button className="icon-button" aria-label="Replay stroke order" title="Replay stroke order" disabled={status !== 'ready'} onClick={replay}><RotateCcw size={16} /></button>
        <button className="icon-button" aria-label="Undo last stroke" title="Undo last stroke" disabled={!strokes.length} onClick={() => setDrawings(previous => ({ ...previous, [index]: strokes.slice(0, -1) }))}><Undo2 size={16} /></button>
        <button className="icon-button" aria-label="Clear drawing" title="Clear drawing" disabled={!strokes.length} onClick={() => setDrawings(previous => ({ ...previous, [index]: [] }))}><Eraser size={16} /></button>
      </div>
    </div>
  </section>;
}
