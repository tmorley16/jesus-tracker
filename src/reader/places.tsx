import meta from '../data/sections.meta.json';
import { BOOK_ABBR, placeKey, type Book, type Row } from './model';

interface PlaceDef { name: string; kind?: 'site' | 'region' | 'water' }
export const PLACE_DEFS = (meta as unknown as { places: Record<string, PlaceDef> }).places;

export interface Candidate { label: string; lonlat: [number, number]; score: number | null }
export interface PlaceData {
  name: string;
  kind: 'site' | 'region' | 'water';
  candidates: Candidate[];
  openbible?: { id: string; name: string; url: string };
  /** English Wikipedia article (via Wikidata), with a note where it covers an identification. */
  wiki?: { id: string; title: string; note?: string };
  /** A photo of the place from Wikimedia Commons (500 px wide), with what it shows and its credit. */
  photo?: { src: string; caption: string; page: string; author: string | null; licence: string | null; licenceUrl: string | null };
}

let cache: Promise<Record<string, PlaceData>> | null = null;
export function loadPlaces(): Promise<Record<string, PlaceData>> {
  cache ??= fetch(new URL('data/places.json', document.baseURI)).then((r) => r.json()).then((j) => j.places);
  return cache;
}

/** The place a section names, or each gospel's place when they name different ones. */
export function PlaceChip({ row, book }: { row: Row; book: Book | null }) {
  if (!row.place) return null;
  if (typeof row.place === 'object' && !book) {
    const byPlace = new Map<string, Book[]>();
    for (const [b, k] of Object.entries(row.place) as [Book, string][]) byPlace.set(k, [...(byPlace.get(k) ?? []), b]);
    return (
      <span className="chip place" title="The gospels name different places here">
        {[...byPlace].map(([k, bs]) => `${PLACE_DEFS[k]?.name ?? k} (${bs.map((b) => BOOK_ABBR[b]).join(', ')})`).join(' · ')}
      </span>
    );
  }
  const key = placeKey(row, book);
  if (!key) return null;
  return (
    <span className="chip place" title={row.placeImplied ? 'Implied by the context; the text doesn’t name the place here' : 'Named in the text'}>
      {PLACE_DEFS[key]?.name ?? key}{row.placeImplied && <em> · implied</em>}
    </span>
  );
}
