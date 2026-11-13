// "Waarom deze risico-indicatie?": what each risk letter rests on, in a sentence. The source comes from the model's own
// record, sent with the analysis (`explanation`, FunderMapsStudio #87); this only words it, the same words as the
// Studio's Pand page. Nothing is re-derived here, so it cannot disagree with the letter. Always "risico-indicatie".
import type { Row } from './fields';

type RiskKey = 'drystandRisk' | 'dewateringDepthRisk' | 'bioInfectionRisk' | 'unclassifiedRisk';

/** what the model's own estimate reads for a risk: the inputs, never a threshold (the rules live in the model) */
const MODEL_INPUTS: Partial<Record<RiskKey, string>> = {
  drystandRisk: 'het funderingstype, de grondwaterstand en de zakking van het bouwblok',
  dewateringDepthRisk: 'het funderingstype, de grondwaterstand en de zakking van het bouwblok',
  bioInfectionRisk: 'het funderingstype, de paallengte en de zakking',
};

function sourceLine(key: RiskKey, source: string | null): string {
  switch (source) {
    case 'quickscan': return 'Overgenomen uit de QuickScan van dit pand.';
    case 'research': return 'Uit onderzoek aan dit pand zelf.';
    case 'herstel': return 'Dit pand heeft funderingsherstel.';
    case 'cluster': return 'Uit onderzoek of herstel in hetzelfde bouwblok.';
    case 'model': return `Geschat door het model uit ${MODEL_INPUTS[key] ?? 'de gegevens van het pand'}.`;
    case 'build_year': return 'Geen andere gegevens: afgeleid van het bouwjaar.';
    case null: return 'Niet van toepassing op dit pand.';
    default: return 'De herkomst is niet vastgelegd.';
  }
}

const GATE_LINE: Record<string, string> = {
  qs_valid: 'Er is een geldige QuickScan: die gaat voor op de schatting van het model.',
  qs_expired: 'De QuickScan van dit pand is verlopen en telt niet meer mee.',
  fo_leading: 'Een recent funderingsonderzoek gaat voor op de QuickScan.',
};

export interface Explanation {
  /** a QuickScan or a recent foundation report took the lead; null when neither plays */
  gate: string | null;
  /** per risk, the sentence */
  why: Partial<Record<RiskKey, string>>;
}

/** null when the analysis carries no explanation (an API before it, or a model that recorded no sources) */
export function explanationOf(analysis: Row | null): Explanation | null {
  const e = analysis?.explanation as { quickscanGate?: string | null; risks?: { key?: string; source?: string | null }[] } | null | undefined;
  if (!e || !Array.isArray(e.risks)) return null;
  const why: Explanation['why'] = {};
  for (const r of e.risks) {
    if (r.key === 'drystandRisk' || r.key === 'dewateringDepthRisk' || r.key === 'bioInfectionRisk' || r.key === 'unclassifiedRisk') why[r.key] = sourceLine(r.key, r.source ?? null);
  }
  return { gate: e.quickscanGate ? GATE_LINE[e.quickscanGate] ?? null : null, why };
}
