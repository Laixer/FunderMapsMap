// How a field of the building panel is shown: its Dutch label, its value translated (enum values by their wire name,
// never by position), and its unit. Labels and enum texts are the current map app's (labels.json, tools/freeze-labels.py).
import frozen from './labels.json';

const ENUMS = frozen.enums as Record<string, Record<string, string>>;
const FIELDS = frozen.fields as Record<string, Record<string, string>>;
export const NO_DATA = 'Geen data';

const nf2 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const num = (v: unknown) => Number.parseFloat(String(v));
const unit = (u: string) => (v: unknown) => `${nf2.format(num(v))} ${u}`;
export const date = (v: unknown) => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'numeric', year: 'numeric' });
};
const NAP = unit('m t.o.v. NAP'), MM = unit('mm'), M = unit('m'), MM_YEAR = unit('mm/jaar');
const scale = (v: unknown) => `1:${num(v).toFixed(0)}`;

const FORMAT: Record<string, (v: unknown) => string> = {
  restorationCosts: (v) => euro.format(num(v)), velocity: MM_YEAR, settlementSpeed: MM_YEAR, surfaceArea: unit('m²'),
  height: M, drystand: M, dewateringDepth: M, pileDistanceLength: M, concreteChargerLength: M,
  groundWaterLevel: unit('m beneden maaiveldniveau'),
  groundLevel: NAP, groundwaterLevelNet: NAP, groundwaterLevelTemp: NAP, pileHeadLevel: NAP, pileTipLevel: NAP, foundationDepth: NAP,
  constructionLevel: NAP, woodLevel: NAP, masonLevel: NAP, thresholdFrontLevel: NAP, thresholdBackLevel: NAP,
  pileDiameterTop: MM, pileDiameterBottom: MM, woodPenetrationDepth: MM, crackIndoorSize: MM, crackFacadeFrontSize: MM,
  crackFacadeBackSize: MM, crackFacadeLeftSize: MM, crackFacadeRightSize: MM,
  skewedParallel: scale, skewedPerpendicular: scale,
  createDate: date, documentDate: date, permitDate: date, recoveryDate: date,
  builtYear: (v) => String(v).slice(0, 4),
};

/** which enum translates a field's value */
const ENUM_OF: Record<string, string> = {
  constructionYearReliability: 'Reliability', foundationTypeReliability: 'Reliability', drystandReliability: 'Reliability',
  dewateringDepthReliability: 'Reliability', bioInfectionReliability: 'Reliability',
  drystandRisk: 'FoundationRisk', dewateringDepthRisk: 'FoundationRisk', bioInfectionRisk: 'FoundationRisk', unclassifiedRisk: 'FoundationRisk',
  recoveryType: 'RecoveryType', damageCause: 'FoundationDamageCause', foundationDamageCause: 'FoundationDamageCause',
  enforcementTerm: 'EnforcementTerm', overallQuality: 'FoundationQuality', inquiryType: 'InquiryType', foundationType: 'FoundationType',
  soil: 'Soil', auditStatus: 'AuditStatus', substructure: 'Substructure', damageCharacteristics: 'FoundationDamageCharacteristics',
  foundationDamageCharacteristics: 'FoundationDamageCharacteristics', environmentDamageCharacteristics: 'EnvironmentDamageCharacteristics',
  constructionPile: 'ConstructionPile', woodType: 'WoodType', woodEncroachement: 'WoodEncroachement', woodQuality: 'WoodQuality',
  constructionQuality: 'Quality', woodCapacityHorizontalQuality: 'Quality', pileWoodCapacityVerticalQuality: 'Quality',
  carryingCapacityQuality: 'Quality', masonQuality: 'Quality',
  crackIndoorType: 'CrackType', crackFacadeFrontType: 'CrackType', crackFacadeBackType: 'CrackType', crackFacadeLeftType: 'CrackType', crackFacadeRightType: 'CrackType',
  skewedParallelFacade: 'RotationType', skewedPerpendicularFacade: 'RotationType',
  status: 'RecoveryStatus', pileType: 'PileType', facade: 'Facade', incidentQuestionType: 'IncidentQuestionType',
};
/** `type` means something else per record */
const TYPE_ENUM: Record<string, string> = { inquiry: 'InquiryType', recovery: 'RecoveryDocumentType', recoverySample: 'RecoveryType' };

/** the API's name of a field where it is not simply the snake_case of ours */
const WIRE: Record<string, string> = {
  drystandReliability: 'drystand_risk_reliability', dewateringDepthReliability: 'dewatering_depth_risk_reliability',
  bioInfectionReliability: 'bio_infection_risk_reliability',
  contractorName: 'attribution_contractor_name', ownerName: 'attribution_owner_name', dataOwnerName: 'attribution_data_owner_name',
  woodEncroachement: 'wood_encroachement', standardF3o: 'standard_f3o',
  email: 'contact', name: 'contact_name', phoneNumber: 'contact_phone_number', incidentQuestionType: 'question_type',
};
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

export type Row = Record<string, unknown>;
export type Kind = 'analysis' | 'inquiry' | 'inquirySample' | 'recovery' | 'recoverySample' | 'incident';
const LABEL_SETS: Record<Kind, string[]> = {
  analysis: ['analysis', 'risk'], inquiry: ['inquiry', 'attributionControl', 'stateControl'], inquirySample: ['inquirySample'],
  recovery: ['recovery', 'attributionControl', 'stateControl'], recoverySample: ['recoverySample'], incident: ['incident'],
};

export function label(kind: Kind, field: string): string {
  for (const set of LABEL_SETS[kind]) { const l = FIELDS[set]?.[field]; if (l) return l; }
  return field;
}

/** the raw value of a field in a row as the API sent it (the sample table has two names of its own) */
export function raw(row: Row | null | undefined, field: string): unknown {
  if (!row) return undefined;
  const key = WIRE[field] ?? snake(field);
  if (key in row) return row[key];
  if (field === 'groundLevel' && 'groundlevel' in row) return row.groundlevel;
  if (field === 'woodEncroachement' && 'wood_encroachment' in row) return row.wood_encroachment;
  return row[field];
}

const translate = (enumName: string, v: unknown) => ENUMS[enumName]?.[String(v)] ?? String(v).replace(/_/g, ' ');

/** the value as shown; NO_DATA when there is none */
export function show(kind: Kind, field: string, value: unknown): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return NO_DATA;
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nee';
  const enumName = field === 'type' ? TYPE_ENUM[kind] : ENUM_OF[field];
  if (enumName) return Array.isArray(value) ? value.map((v) => translate(enumName, v)).join(', ') : translate(enumName, value);
  const f = FORMAT[field];
  if (f) return f(value);
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export interface Shown { field: string; label: string; value: string; empty: boolean }
/** label and value of each field of a row, in the order given */
export function rows(kind: Kind, row: Row | null | undefined, fields: string[], labels: Record<string, string> = {}): Shown[] {
  return fields.map((field) => {
    const value = show(kind, field, raw(row, field));
    return { field, label: labels[field] ?? label(kind, field), value, empty: value === NO_DATA };
  });
}

export const enumLabel = translate;

/** the groups of the sample dialog, as the current map app has them */
export const SAMPLE_GROUPS: { title: string; fields: string[] }[] = [
  { title: 'Pand', fields: ['note', 'builtYear', 'substructure', 'foundationType', 'recoveryAdvised'] },
  { title: 'Omgeving', fields: ['cpt', 'groundLevel', 'groundwaterLevelNet', 'monitoringWell', 'groundwaterLevelTemp'] },
  { title: 'Kwaliteit', fields: ['enforcementTerm', 'damageCause', 'overallQuality', 'damageCharacteristics'] },
  { title: 'Palen & hout', fields: ['pileHeadLevel', 'pileDiameterTop', 'pileDistanceLength', 'pileTipLevel', 'pileDiameterBottom', 'concreteChargerLength', 'woodType', 'woodPenetrationDepth', 'woodQuality', 'carryingCapacityQuality', 'woodEncroachement', 'pileWoodCapacityVerticalQuality', 'woodQualityNecessity', 'woodCapacityHorizontalQuality'] },
  { title: 'Kwaliteit metselwerk', fields: ['constructionQuality', 'foundationDepth', 'constructionLevel', 'woodLevel', 'masonLevel', 'masonQuality', 'constructionPile'] },
  { title: 'Vervorming', fields: ['settlementSpeed', 'deformedFacade', 'skewedParallelFacade', 'skewedParallel', 'thresholdFrontLevel', 'skewedWindowFrame', 'thresholdUpdownSkewed', 'skewedPerpendicularFacade', 'skewedPerpendicular', 'thresholdBackLevel'] },
  { title: 'Scheuren', fields: ['crackIndoorRestored', 'crackIndoorType', 'crackIndoorSize'] },
  { title: 'Scheur voorgevel', fields: ['crackFacadeFrontRestored', 'crackFacadeFrontType', 'crackFacadeFrontSize'] },
  { title: 'Scheur achtergevel', fields: ['crackFacadeBackRestored', 'crackFacadeBackType', 'crackFacadeBackSize'] },
  { title: 'Scheur linkergevel', fields: ['crackFacadeLeftRestored', 'crackFacadeLeftType', 'crackFacadeLeftSize'] },
  { title: 'Scheur rechtergevel', fields: ['crackFacadeRightRestored', 'crackFacadeRightType', 'crackFacadeRightSize'] },
];
export const RECOVERY_SAMPLE_FIELDS = ['recovery', 'type', 'pileType', 'status', 'note', 'contractor', 'facade', 'permit', 'permitDate', 'recoveryDate'];
