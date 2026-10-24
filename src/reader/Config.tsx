// Each area's settings behind a small round button of its own (the timeline's, the gospels', and the map's layers), in
// place of one Settings dialog.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RECKONING_NAME, type Reckoning } from './model';
import { collapseHidden, useUI, type Appearance, type NotesShown, type PaneSync, type PhoneGospels, type Spacing, type TextSize } from './state';

const SlidersIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
);

/** A button that opens a small panel above it (or below, `down`). A tap off the panel only closes it: a backdrop takes
 *  it, so nothing underneath is pressed. */
export function ConfigButton({ label, icon, down = false, className = '', children }: {
  label: string; icon: ReactNode; down?: boolean; className?: string; children: ReactNode;
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
        {icon}
      </button>
    </div>
  );
}

/** A row: its name on the left, its choices on the right, the chosen one filled. Options are [value, text, title?]. */
export function Choice<T extends string>({ label, group = label, value, options, set }: {
  label: string; group?: string; value: T; options: [T, ReactNode, string?][]; set: (v: T) => void;
}) {
  return (
    <div className="cfg-row">
      <span className="cfg-label">{label}</span>
      <div className="cfg-seg" role="group" aria-label={group}>
        {options.map(([v, content, title]) => (
          <button type="button" key={v} aria-pressed={value === v} onClick={() => set(v)} aria-label={title} title={title}>{content}</button>
        ))}
      </div>
    </div>
  );
}

/** A row that switches something on or off: its name on the left, a switch on the right. */
export function Toggle({ label, on, set, title }: { label: string; on: boolean; set: (on: boolean) => void; title?: string }) {
  return (
    <button type="button" className="cfg-toggle" aria-pressed={on} onClick={() => set(!on)} title={title}>
      <span>{label}</span><i aria-hidden="true" />
    </button>
  );
}

/** The timeline's: its scale first; on the Time scale, the reckoning and the compression; on phones the phase bands and
 *  feasts (desktops always show the phases), on desktops the feasts and the strip of the time of day. */
export function TimelineConfig({ desk = false }: { desk?: boolean }) {
  const spacing = useUI((s) => s.spacing);
  const reckoning = useUI((s) => s.reckoning);
  const compress = useUI((s) => s.compress);
  const phases = useUI((s) => s.phases);
  const timeMarks = useUI((s) => s.timeMarks);
  const collapse = useUI((s) => collapseHidden(s.collapse, !desk));
  const ui = useUI.getState();
  return (
    <ConfigButton label="Timeline settings" icon={<SlidersIcon />} down className="tl-cfg">
      <Choice<Spacing> label="Scale" group="Timeline scale" value={spacing} options={[['text', 'Text'], ['chrono', 'Time']]} set={ui.setSpacing} />
      {spacing === 'chrono' && (
        <>
          <Choice<Reckoning> label="Crucifixion" value={reckoning} options={[['ad30', 'AD 30'], ['ad33', 'AD 33']]} set={ui.setReckoning} />
          <Toggle label="Compress the hidden years" on={compress} set={ui.setCompress} title="Shorten the long silences: childhood, and the years after age twelve" />
        </>
      )}
      {desk
        ? <><Toggle label="Collapse hidden gospels" on={collapse} set={ui.setCollapse} title="Leave out the sections only hidden gospels tell (off: keep them in their place, faded)" />
          <Toggle label="Feasts and time of day" on={timeMarks} set={ui.setTimeMarks} title="The feasts the text names, as diamonds along the top, and a strip along the foot tinted where the text gives a time of day" /></>
        : <><Toggle label="Phases and feasts" on={phases} set={ui.setPhases} />
          <Toggle label="Collapse hidden gospels" on={collapse} set={ui.setCollapse} title="Leave out the sections only hidden gospels tell (off: keep them in their place, faded)" /></>}
      {spacing === 'chrono' && <p className="cfg-note">Years are estimates ({RECKONING_NAME[reckoning]}).</p>}
      {desk && <p className="cfg-note">Drag or click to move · wheel or + − to zoom, 0 for the whole · ← → step through events.</p>}
    </ConfigButton>
  );
}

// The layouts drawn: four dots for quadrants, four columns side by side, four bands stacked.
const LayoutIcon = ({ kind }: { kind: PhoneGospels }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="cfg-glyph">
    {kind === 'grid' && [[6, 6], [14, 6], [6, 14], [14, 14]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.6" />)}
    {kind === 'columns' && [3, 7.5, 12, 16.5].map((x) => <rect key={x} x={x - 1.1} y="3" width="2.2" height="14" rx="1.1" />)}
    {kind === 'stacked' && [3, 7.5, 12, 16.5].map((y) => <rect key={y} x="3" y={y - 1.1} width="14" height="2.2" rx="1.1" />)}
  </svg>
);

/** The gospels': on phones their layout, equal or own lengths in panes and shrinking; text size, colours, notes and the
 *  text's sources. Desktops keep the gospels side by side, scrolled together. */
export function GospelConfig({ desk = false }: { desk?: boolean }) {
  const phoneGospels = useUI((s) => s.phoneGospels);
  const paneSync = useUI((s) => s.paneSync);
  const shrinkMissing = useUI((s) => s.shrinkMissing);
  const textSize = useUI((s) => s.textSize);
  const appearance = useUI((s) => s.appearance);
  const notes = useUI((s) => s.notes);
  const ui = useUI.getState();
  return (
    <ConfigButton label="Gospel settings" icon={<SlidersIcon />} className="gospel-cfg">
      {!desk && <Choice<PhoneGospels>
        label="Layout" value={phoneGospels} set={ui.setPhoneGospels}
        options={[['grid', <LayoutIcon kind="grid" />, 'Quadrants'], ['columns', <LayoutIcon kind="columns" />, 'Side by side'], ['stacked', <LayoutIcon kind="stacked" />, 'Stacked']]}
      />}
      {!desk && phoneGospels !== 'one' && (
        <Toggle label="Shrink missing" on={shrinkMissing} set={ui.setShrinkMissing} title="Make room for the accounts that tell the section: a row or column of gospels where none has it gets smaller" />
      )}
      {!desk && (phoneGospels === 'stacked' || phoneGospels === 'grid') && (
        <Choice<PaneSync> label="Lengths" value={paneSync} options={[['locked', 'Equal', 'Equal: every section as long in each pane, scrolled together'], ['follow', 'Own', 'Own: each pane its own length, following the one you scroll']]} set={ui.setPaneSync} />
      )}
      <Choice<TextSize> label="Text size" value={textSize} options={[['s', 'S'], ['m', 'M'], ['l', 'L']]} set={ui.setTextSize} />
      <Choice<Appearance> label="Colours" value={appearance} options={[['dynamic', 'Dynamic'], ['light', 'Light'], ['dark', 'Dark']]} set={ui.setAppearance} />
      <Choice<NotesShown> label="BSB notes" value={notes} options={[['all', 'All'], ['textual', 'Manuscripts'], ['none', 'None']]} set={ui.setNotes} />
      <p className="cfg-note">Text: BSB (public domain). Order: Robertson’s <i>Harmony</i> (1922).{desk && <><br />Keys: 1–4 show or hide a gospel · M map · T timeline · / go to.</>}</p>
    </ConfigButton>
  );
}
