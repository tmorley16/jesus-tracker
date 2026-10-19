// The BSB's footnotes in the reader: a small letter in the text where the BSB puts each note,
// and the note itself, shown on hover or focus and kept open when clicked or tapped.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { BOOK_ABBR, NOTES, NOTE_KIND_NAME, noteForOmitted, parseLoc, rowForVerse, type Book, type Note } from './model';
import { nav, useUI, type NotesShown } from './state';

const letter = (n: number) => String.fromCharCode(97 + (n % 26)).repeat(Math.floor(n / 26) + 1);
const noteId = (book: Book, key: string, i: number) => `${book}|${key}|${i}`;
function lookup(id: string): { book: Book; key: string; note: Note } | null {
  const [book, key, i] = id.split('|');
  const note = NOTES[book as Book]?.[key]?.[Number(i)];
  return note ? { book: book as Book, key, note } : null;
}

/** A verse's words with the BSB's note marks where the BSB puts them. `next` hands out the cell's letters in order. */
export function VerseText({ book, c, v, text, shown, next }: { book: Book; c: number; v: number; text: string; shown: NotesShown; next: () => number }) {
  const key = `${c}:${v}`;
  if (!text) {
    const o = noteForOmitted(book, c, v);
    const words = '(not in the BSB main text; found in later manuscripts)';
    return o
      ? <><button type="button" className="omit" data-note={noteId(book, o.key, o.i)} aria-haspopup="dialog" title="Show the BSB note">{words}</button>{' '}</>
      : <><span className="omit">{words}</span>{' '}</>;
  }
  const notes = shown === 'none' ? [] : (NOTES[book]?.[key] ?? []).map((note, i) => ({ note, i })).filter(({ note }) => shown === 'all' || note.kind === 'textual');
  if (!notes.length) return <>{text} </>;
  const out: React.ReactNode[] = [];
  let cut = 0;
  notes.forEach(({ note, i }) => {
    const at = Math.max(cut, Math.min(text.length, note.at));
    out.push(text.slice(cut, at));
    const l = letter(next());
    out.push(
      <span className="fn" data-kind={note.kind} key={i}>
        <button type="button" className="fn-mark" data-note={noteId(book, key, i)} aria-haspopup="dialog" aria-label={`Note ${l} (${NOTE_KIND_NAME[note.kind].toLowerCase()})`}>{l}</button>
      </span>,
    );
    cut = at;
  });
  out.push(`${text.slice(cut)} `);
  return <>{out}</>;
}

function NoteBody({ note, onGo }: { note: Note; onGo: (loc: string) => void }) {
  return (
    <p className="note-body">
      {note.body.map((s, k) => {
        if (typeof s === 'string') return s;
        if ('q' in s) return <i key={k}>{s.q}</i>;
        if ('v' in s) return <sup key={k} className="vn">{s.v}</sup>;
        return parseLoc(s.loc)
          ? <button type="button" key={k} className="note-ref" onClick={() => onGo(s.loc)}>{s.ref}</button>
          : <span key={k} className="note-ref">{s.ref}</span>;
      })}
    </p>
  );
}

interface Open { id: string; anchor: HTMLElement; pinned: boolean }

/** One note at a time, placed by its mark inside the scrolling reader so it moves with the text. */
export function NotePopover({ host }: { host: RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  openRef.current = open;
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const later = (fn: () => void, ms: number) => { clearTimeout(timer.current); timer.current = window.setTimeout(fn, ms); };
  const close = useCallback((refocus = false) => {
    clearTimeout(timer.current);
    if (refocus) openRef.current?.anchor.focus();
    setOpen(null);
  }, []);

  useEffect(() => {
    const h = host.current;
    if (!h) return;
    const trigger = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>('.fn-mark, .omit[data-note]') : null);
    const show = (anchor: HTMLElement, pinned: boolean) => setOpen({ id: anchor.dataset.note!, anchor, pinned });
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const t = trigger(e.target);
      if (!t) return;
      if (openRef.current?.pinned) return;
      later(() => show(t, false), openRef.current ? 0 : 90);
    };
    const onOut = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || openRef.current?.pinned) return;
      if (!trigger(e.target)) return;
      const to = e.relatedTarget as Node | null;
      if (to && (pop.current?.contains(to) || trigger(to))) return;
      later(() => setOpen((o) => (o?.pinned ? o : null)), 180);
    };
    const onClick = (e: MouseEvent) => {
      const t = trigger(e.target);
      if (!t) return;
      e.preventDefault();
      clearTimeout(timer.current);
      const o = openRef.current;
      if (o?.pinned && o.anchor === t) setOpen(null);
      else show(t, true);
    };
    const onFocus = (e: FocusEvent) => {
      const t = trigger(e.target);
      if (t && !openRef.current?.pinned && t.matches(':focus-visible')) show(t, false);
    };
    const onBlur = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (openRef.current && !openRef.current.pinned && !(to && pop.current?.contains(to))) setOpen(null);
    };
    const onScroll = () => { if (openRef.current && !openRef.current.pinned) setOpen(null); };
    h.addEventListener('pointerover', onOver);
    h.addEventListener('pointerout', onOut);
    h.addEventListener('click', onClick);
    h.addEventListener('focusin', onFocus);
    h.addEventListener('focusout', onBlur);
    h.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer.current);
      h.removeEventListener('pointerover', onOver);
      h.removeEventListener('pointerout', onOut);
      h.removeEventListener('click', onClick);
      h.removeEventListener('focusin', onFocus);
      h.removeEventListener('focusout', onBlur);
      h.removeEventListener('scroll', onScroll);
    };
  }, [host]);

  // A pinned note closes on Escape or a tap elsewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!pop.current?.contains(t) && !t.closest?.('.fn, .omit[data-note]')) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open, close]);

  // The mark it belongs to shows as active while it's open.
  useEffect(() => {
    if (!open) return;
    open.anchor.setAttribute('aria-expanded', 'true');
    open.anchor.closest('.fn')?.classList.add('open');
    return () => { open.anchor.removeAttribute('aria-expanded'); open.anchor.closest('.fn')?.classList.remove('open'); };
  }, [open]);

  // Below the mark, or above it when there's no room; kept inside the reader's width.
  useLayoutEffect(() => {
    const h = host.current, p = pop.current;
    if (!open || !h || !p) return;
    if (!open.anchor.isConnected) { setOpen(null); return; }
    const hr = h.getBoundingClientRect(), ar = open.anchor.getBoundingClientRect();
    const w = p.offsetWidth, ht = p.offsetHeight;
    const left = Math.min(Math.max(8, ar.left - hr.left - 24), h.clientWidth - w - 8);
    const below = ar.bottom + 8 + ht <= hr.bottom || ar.top - hr.top < ht + 16;
    const top = (below ? ar.bottom - hr.top + 6 : ar.top - hr.top - ht - 6) + h.scrollTop;
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
    p.dataset.side = below ? 'below' : 'above';
  }, [open, host]);

  const go = useCallback((loc: string) => {
    const p = parseLoc(loc);
    if (!p) return;
    const i = rowForVerse(p.book, p.c, p.v);
    if (i < 0) return;
    close();
    const ui = useUI.getState();
    if (!ui.visible.includes(p.book)) {
      if (ui.visible.length === 1) ui.setSingle(p.book); else ui.toggleBook(p.book);
      requestAnimationFrame(() => requestAnimationFrame(() => nav.toRow?.(i))); // after the new column is measured
    } else nav.toRow?.(i);
  }, [close]);

  const found = open ? lookup(open.id) : null;
  if (!open || !found) return null;
  const { book, key, note } = found;
  const mark = open.anchor.classList.contains('fn-mark') ? open.anchor.textContent : null;
  return (
    <div
      className="note-pop" ref={pop} data-kind={note.kind} data-pinned={open.pinned || undefined}
      style={{ '--g': `var(--gospel-${book.toLowerCase()})` } as CSSProperties}
      role={open.pinned ? 'dialog' : 'tooltip'} aria-label={`BSB note on ${BOOK_ABBR[book]} ${key}`}
      onPointerEnter={() => clearTimeout(timer.current)}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !openRef.current?.pinned) later(() => setOpen((o) => (o?.pinned ? o : null)), 180); }}
    >
      <p className="note-kicker">
        {mark && <b>{mark}</b>}
        <span>{NOTE_KIND_NAME[note.kind]}</span>
        <span>· {BOOK_ABBR[book]} {key}</span>
        {open.pinned && <button type="button" className="note-close" aria-label="Close note" onClick={() => close(true)}>×</button>}
      </p>
      <NoteBody note={note} onGo={go} />
    </div>
  );
}
