// Everything the building panel shows, from the API's customer part with the login cookie. The five loads run
// together; the panel shows as soon as the place and the analysis are in. The analysis and statistics calls are the
// billed ones, exactly as in the current map app.
import { reactive } from 'vue';
import { api } from '@/api/client';
import { API } from '@/config';
import type { Row } from './fields';

export interface Place {
  building_id?: string; street?: string | null; building_number?: string | null; postal_code?: string | null; city?: string | null;
  neighborhood_name?: string | null; neighborhood_external_id?: string | null; district_name?: string | null; district_external_id?: string | null;
  municipality_name?: string | null; municipality_external_id?: string | null; state_name?: string | null; state_external_id?: string | null;
}
export interface Statistics {
  foundation_type_distribution?: { foundation_type: string; percentage: number }[];
  construction_year_distribution?: { year_from: number; count: number }[];
  foundation_risk_distribution?: { foundation_risk: string; percentage: number }[];
  total_incident_count?: { year: number; count: number }[]; municipality_incident_count?: { year: number; count: number }[];
  total_report_count?: { year: number; count: number }[]; municipality_report_count?: { year: number; count: number }[];
}
export interface Subsidence { velocity: number; mark_at: string }

export interface PanelData {
  pand: string;
  /** the place and the analysis are in (or one of them failed) */
  ready: boolean;
  failed: boolean;
  place: Place | null;
  analysis: Row | null;
  /** undefined while loading, null when it failed */
  statistics: Statistics | null | undefined;
  subsidence: Subsidence[];
  /** false while the reports are loading */
  reportsReady: boolean;
  inquiries: Row[]; inquirySamples: Row[]; recoveries: Row[]; recoverySamples: Row[];
  /** incidents (our own reports of damage) and meldingen (from the public form), newest first */
  incidents: Row[];
}

/** id = the 16-digit pand number */
export function loadPanel(pand: string, signal: AbortSignal): PanelData {
  const id = `NL.IMBAG.PAND.${pand}`;
  const d = reactive<PanelData>({
    pand, ready: false, failed: false, place: null, analysis: null, statistics: undefined, subsidence: [], reportsReady: false,
    inquiries: [], inquirySamples: [], recoveries: [], recoverySamples: [], incidents: [],
  });
  const alive = () => !signal.aborted;
  const first = Promise.allSettled([
    api<Place>(`geocoder/building-info/${id}`, { signal }).then((p) => { d.place = p; }),
    api<Row>(`product/${id}/analysis`, { signal }).then((a) => { d.analysis = a; }),
  ]).then((r) => { if (alive()) { d.failed = r.some((x) => x.status === 'rejected'); d.ready = true; } });
  void first;
  api<Statistics>(`product/${id}/statistics`, { signal }).then((s) => { d.statistics = s; }, () => { if (alive()) d.statistics = null; });
  api<Subsidence[]>(`product/${id}/subsidence/historic`, { signal }).then((s) => { d.subsidence = Array.isArray(s) ? s : []; }, () => undefined);
  const byDate = (a: Row, b: Row) => String(b.create_date ?? '').localeCompare(String(a.create_date ?? ''));
  Promise.allSettled([
    api<{ incidents: Row[]; inquiries: Row[]; inquiry_samples: Row[]; recoveries: Row[]; recovery_samples: Row[] }>(`report/${id}`, { signal }),
    // meldingen from the public form; a failure here is "none", as in the current map app
    api<Row[]>(`incident/building/${id}?include=meldingen`, { signal }),
  ]).then(([report, meldingen]) => {
    if (!alive()) return;
    if (report.status === 'fulfilled') {
      d.inquiries = report.value.inquiries ?? []; d.inquirySamples = report.value.inquiry_samples ?? [];
      d.recoveries = report.value.recoveries ?? []; d.recoverySamples = report.value.recovery_samples ?? [];
      d.incidents = (report.value.incidents ?? []).map((i) => ({ ...i, kind: 'incident' }));
    }
    if (meldingen.status === 'fulfilled' && Array.isArray(meldingen.value)) {
      d.incidents = [...d.incidents, ...meldingen.value.filter((m) => m.kind === 'melding' && m.topic)].sort(byDate);
    }
    d.reportsReady = true;
  });
  return d;
}

/** a short-lived link to the document of a rapportage or a recovery; null when there is none */
export async function documentLink(kind: 'inquiry' | 'recovery', id: unknown): Promise<string | null> {
  const res = await api<{ accessLink?: string }>(`${kind}/${id}/download`);
  return res?.accessLink || null;
}

/** the PDF report of a building, made by the API (takes about ten seconds) */
export async function pdfReport(pand: string): Promise<Blob> {
  const res = await fetch(`${API}/api/pdf/NL.IMBAG.PAND.${pand}`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(`pdf ${res.status}`);
  return res.blob();
}

/** "Straat 12" of an address id (public lookup); null when it cannot be found */
export async function addressLabel(addressId: unknown): Promise<string | null> {
  try {
    const a = await api<{ street?: string; building_number?: string }>(`geocoder/address/${addressId}`, { quiet401: true });
    return a?.street ? `${a.street} ${a.building_number ?? ''}`.trim() : null;
  } catch {
    return null;
  }
}

export function save(blob: Blob | string, filename: string) {
  const url = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  if (typeof blob === 'string') a.target = '_blank';
  document.body.append(a); a.click(); a.remove();
  if (typeof blob !== 'string') setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
