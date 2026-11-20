import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import HanziWriter from 'hanzi-writer';
import { Eraser, RotateCcw, Undo2 } from 'lucide-react';
import './writing.css';

type Point = { x: number; y: number };
type Stroke = Point[];
type GuideStatus = 'loading' | 'ready' | 'error';
const SIZE = 300;
const pathOf = (points: Stroke) => points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');

export function WritingPad({ word, active = true, onTap }: { word: string; active?: boolean; onTap: () => void }) {
  const characters = Array.from(word);
  // Keep two/three-character words on one line; longer phrases wrap in reading order.
  const columns = characters.length === 4 ? 2 : Math.min(3, Math.max(1, characters.length));
  const rows = Math.max(1, Math.ceil(characters.length / columns));
  const width = SIZE * columns;
  const height = SIZE * rows;
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke>([]);
  const [statuses, setStatuses] = useState<GuideStatus[]>(() => characters.map(() => 'loading'));
  const targets = useRef<Array<HTMLDivElement | null>>([]);
  const replayAnimation = useRef<(() => void) | null>(null);
  const activePointer = useRef<number | null>(null);
  const currentRef = useRef<Stroke>([]);
  const gesture = useRef<{ x: number; y: number; startedAt: number; moved: boolean } | null>(null);
  const tapReady = useRef(false);

  useEffect(() => { setStrokes([]); }, [word]);
  useEffect(() => {
    activePointer.current = null;
    currentRef.current = [];
    gesture.current = null;
    tapReady.current = false;
    setCurrent([]);
    if (!active) return;
    let disposed = false;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const chars = Array.from(word);
    const loaded: GuideStatus[] = chars.map(() => 'loading');
    const writers: HanziWriter[] = [];
    const mounts: HTMLDivElement[] = [];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setStatuses([...loaded]);

    const animateWord = async (run: number) => {
      const isCurrent = () => !disposed && sequence === run;
      const ready = writers.filter((_, i) => loaded[i] === 'ready');
      try {
        await Promise.all(ready.map(writer => writer.hideCharacter({ duration: 0 })));
        if (!isCurrent()) return;
        for (const writer of ready) {
          await writer.animateCharacter();
          if (!isCurrent()) return;
        }
        if (!reducedMotion) timer = setTimeout(() => { void animateWord(run); }, 1600);
      } catch {
        // An aborted character fetch or a replaced animation should stop this run.
      }
    };
    const replay = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      void animateWord(++sequence);
    };
    const updateStatus = (index: number, status: GuideStatus) => {
      if (disposed) return;
      loaded[index] = status;
      setStatuses([...loaded]);
      if (loaded.every(value => value !== 'loading') && loaded.includes('ready')) {
        replayAnimation.current = replay;
        if (!reducedMotion) timer = setTimeout(replay, 1000);
      }
    };

    chars.forEach((character, index) => {
      const target = targets.current[index];
      if (!target) return;
      const mount = document.createElement('div');
      target.appendChild(mount);
      mounts.push(mount);
      const fitGuide = () => {
        const svg = mount.querySelector('svg');
        // The renderer's coordinate system must scale with its square grid cell.
        svg?.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
        svg?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      };
      const instance = HanziWriter.create(mount, character, {
        width: SIZE, height: SIZE, padding: 30,
        showCharacter: true, showOutline: true,
        strokeColor: '#c9c9c9', outlineColor: '#f1f1f1',
        strokeAnimationSpeed: 1.2, delayBetweenStrokes: 120,
        charDataLoader: async char => {
          const response = await fetch(`/hanzi/${encodeURIComponent(char)}.json`, { signal: controller.signal });
          if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('No stroke data');
          return response.json();
        },
        onLoadCharDataSuccess: () => {
          updateStatus(index, 'ready');
          requestAnimationFrame(() => { if (!disposed) fitGuide(); });
        },
        onLoadCharDataError: () => updateStatus(index, 'error'),
      });
      fitGuide();
      writers.push(instance);
    });
    return () => {
      disposed = true;
      sequence++;
      replayAnimation.current = null;
      if (timer) clearTimeout(timer);
      controller.abort();
      // Replacing an animation resolves its pending promise; pausing would leave it pending.
      for (const writer of writers) void writer.hideCharacter({ duration: 0 }).catch(() => {});
      for (const mount of mounts) mount.remove();
    };
  }, [word, active]);

  const position = (event: PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(width, (event.clientX - rect.left) * width / rect.width)), y: Math.max(0, Math.min(height, (event.clientY - rect.top) * height / rect.height)) };
  };
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    tapReady.current = false;
    gesture.current = { x: event.clientX, y: event.clientY, startedAt: performance.now(), moved: false };
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    currentRef.current = [position(event)];
    setCurrent([]);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== event.pointerId || !gesture.current) return;
    event.preventDefault();
    if (Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) >= 8) gesture.current.moved = true;
    currentRef.current = [...currentRef.current, position(event)];
    if (gesture.current.moved || event.pointerType === 'pen') setCurrent(currentRef.current);
  };
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== event.pointerId) return;
    const completed = event.type === 'pointerup';
    tapReady.current = completed && !!gesture.current && !gesture.current.moved && event.pointerType !== 'pen' && performance.now() - gesture.current.startedAt < 350;
    if (completed && !tapReady.current && currentRef.current.length) {
      const stroke = currentRef.current;
      setStrokes(previous => [...previous, stroke]);
    }
    activePointer.current = null;
    gesture.current = null;
    currentRef.current = [];
    setCurrent([]);
  };

  return <section className="practice-area" aria-label="Handwriting practice" style={{ '--practice-columns': columns, '--practice-rows': rows } as CSSProperties} onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()}>
    <div className={`practice-surface ${strokes.length ? 'has-ink' : ''}`}>
      <div className="practice-guide" aria-label={`Stroke order for ${word}`}>
        {characters.map((character, index) => <div className="practice-cell" key={`${index}-${character}`}>
          <div className="practice-character" ref={node => { targets.current[index] = node; }} />
          {statuses[index] === 'error' && <svg className="practice-fallback" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true"><text x="150" y="150" dominantBaseline="central" textAnchor="middle" lang="zh-Hant">{character}</text></svg>}
        </div>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="practice-ink" role="img" aria-label={`Draw ${word} here with your finger, pen, or mouse`} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onClick={event => { event.stopPropagation(); if (tapReady.current) { tapReady.current = false; onTap(); } }}>
        <g stroke="#eaeaea" strokeWidth="0.6" strokeDasharray="3 6">{characters.map((_, index) => {
          const x = (index % columns) * SIZE;
          const y = Math.floor(index / columns) * SIZE;
          return <path key={index} d={`M${x + SIZE / 2} ${y} v${SIZE} M${x} ${y + SIZE / 2} h${SIZE}`} />;
        })}</g>
        {[...strokes, current].filter(stroke => stroke.length).map((stroke, i) => stroke.length === 1 ? <circle key={i} cx={stroke[0].x} cy={stroke[0].y} r="2.6" fill="#252525" /> : <path key={i} d={pathOf(stroke)} fill="none" stroke="#252525" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
    </div>
    <div className="practice-bottom">
      <div className="practice-controls">
        <button className="icon-button" aria-label="Replay stroke order" title="Replay stroke order" disabled={statuses.includes('loading') || !statuses.includes('ready')} onClick={() => replayAnimation.current?.()}><RotateCcw size={16} /></button>
        <button className="icon-button" aria-label="Undo last stroke" title="Undo last stroke" disabled={!strokes.length} onClick={() => setStrokes(previous => previous.slice(0, -1))}><Undo2 size={16} /></button>
        <button className="icon-button" aria-label="Clear drawing" title="Clear drawing" disabled={!strokes.length} onClick={() => setStrokes([])}><Eraser size={16} /></button>
      </div>
    </div>
  </section>;
}
