// Phones: each area's settings behind a small button overlaid in its bottom-right corner (the timeline's, the
// gospels', and the map's layers), in place of a Settings dialog.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RECKONING_NAME, type Reckoning } from './model';
import { ScaleSwitch } from './Timeline';
import { useUI, type Appearance, type NotesShown, type PhoneGospels, type TextSize } from './state';

export const SlidersIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
);

/** A button that opens a small panel above it (or below, `down`). A tap off the panel only closes it: a backdrop takes
 *  it, so nothing underneath is pressed. */
export function ConfigButton({ label, icon, badge = false, down = false, className = '', children }: {
  label: string; icon: ReactNode; badge?: boolean; down?: boolean; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className={`cfg ${down ? 'down ' : ''}${className}`} data-open={open ? '' : undefined}>
      {open && createPortal(<div className="cfg-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />, document.body)}
      {open && <div className="cfg-panel" role="dialog" aria-label={label}>{children}</div>}
      <button type="button" className="cfg-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}{badge && <i aria-hidden="true" />}
      </button>
    </div>
  );
}

/** A row of choices, one pressed. */
function Choice<T extends string>({ label, value, options, set }: { label: string; value: T; options: [T, string][]; set: (v: T) => void }) {
  return (
    <div className="cfg-row">
      <span className="cfg-label">{label}</span>
      <div className="cfg-seg" role="group" aria-label={label}>
        {options.map(([v, text]) => <button type="button" key={v} aria-pressed={value === v} onClick={() => set(v)}>{text}</button>)}
      </div>
    </div>
  );
}

/** The timeline's: its scale first; on the Time scale, the reckoning and the compression; the phase bands and feasts. */
export function TimelineConfig() {
  const spacing = useUI((s) => s.spacing);
  const reckoning = useUI((s) => s.reckoning);
  const compress = useUI((s) => s.compress);
  const phases = useUI((s) => s.phases);
  const ui = useUI.getState();
  return (
    <ConfigButton label="Timeline settings" icon={<SlidersIcon />} down className="tl-cfg">
      <div className="cfg-row"><span className="cfg-label">Scale</span><ScaleSwitch /></div>
      {spacing === 'chrono' && (
        <>
          <Choice<Reckoning> label="Crucifixion" value={reckoning} options={[['ad30', 'AD 30'], ['ad33', 'AD 33']]} set={ui.setReckoning} />
          <button type="button" className="map-toggle" aria-pressed={compress} onClick={() => ui.setCompress(!compress)}>Compress the hidden years</button>
          <p className="cfg-note">Dates are estimates ({RECKONING_NAME[reckoning]}), interpolated between anchor events such as the Passovers in John.</p>
        </>
      )}
      <button type="button" className="map-toggle" aria-pressed={phases} onClick={() => ui.setPhases(!phases)}>Phases and feasts</button>
    </ConfigButton>
  );
}

const LAYOUTS: [PhoneGospels, string][] = [['grid', 'Quadrants'], ['columns', 'Side by side'], ['stacked', 'Stacked']];

/** The gospels': their layout (cycled), equal or own lengths in panes, text size, colours, notes and the text's sources. */
export function GospelConfig() {
  const phoneGospels = useUI((s) => s.phoneGospels);
  const paneSync = useUI((s) => s.paneSync);
  const textSize = useUI((s) => s.textSize);
  const appearance = useUI((s) => s.appearance);
  const notes = useUI((s) => s.notes);
  const ui = useUI.getState();
  const at = LAYOUTS.findIndex(([v]) => v === phoneGospels); // one at a time (an older choice) goes on to Quadrants
  const layoutName = at >= 0 ? LAYOUTS[at][1] : 'One at a time';
  return (
    <ConfigButton label="Gospel settings" icon={<SlidersIcon />} className="gospel-cfg">
      <button type="button" className="cfg-cycle" onClick={() => ui.setPhoneGospels(LAYOUTS[(at + 1) % LAYOUTS.length][0])}>
        Layout <b>{layoutName}</b>
      </button>
      {(phoneGospels === 'stacked' || phoneGospels === 'grid') && (
        <button type="button" className="cfg-cycle" onClick={() => ui.setPaneSync(paneSync === 'locked' ? 'follow' : 'locked')}>
          Lengths <b>{paneSync === 'locked' ? 'Equal' : 'Own'}</b>
        </button>
      )}
      <Choice<TextSize> label="Text size" value={textSize} options={[['s', 'S'], ['m', 'M'], ['l', 'L']]} set={ui.setTextSize} />
      <Choice<Appearance> label="Colours" value={appearance} options={[['dynamic', 'Dynamic'], ['light', 'Light'], ['dark', 'Dark']]} set={ui.setAppearance} />
      <Choice<NotesShown> label="BSB notes" value={notes} options={[['all', 'All'], ['textual', 'Manuscripts'], ['none', 'None']]} set={ui.setNotes} />
      <p className="cfg-note">
        Text: Berean Standard Bible (public domain). Order and sections: A. T. Robertson, <i>A Harmony of the Gospels</i> (1922),
        public domain; titles rewritten to describe what each text narrates.
      </p>
    </ConfigButton>
  );
}
