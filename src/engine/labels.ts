// Display texts (Dutch, user-facing), the same words as the pand panel in the map app (WebFront enums).
export const FOUNDATION_TYPE: Record<string, string> = {
  wood: 'Houten paalfundering',
  wood_amsterdam: 'Houten (Amsterdamse) paalfundering',
  wood_rotterdam: 'Houten (Rotterdamse) paalfundering',
  wood_rotterdam_amsterdam: 'Houten (Rotterdamse/Amsterdamse) paalfundering',
  wood_rotterdam_arch: 'Houten (Rotterdamse) paalfundering met spaarboog',
  wood_amsterdam_arch: 'Houten (Amsterdamse) paalfundering met spaarboog',
  wood_charger: 'Houten paal met betonoplanger',
  concrete: 'Betonpaalfundering',
  weighted_pile: 'Verzwaarde puntpaal',
  steel_pile: 'Stalen buispaal',
  no_pile: 'Ondiepe fundering',
  no_pile_masonry: 'Ondiepe fundering, gemetseld',
  no_pile_strips: 'Ondiepe fundering, stroken',
  no_pile_bearing_floor: 'Ondiepe fundering, plaatfundering',
  no_pile_concrete_floor: 'Ondiepe fundering, betonvloer',
  no_pile_slit: 'Ondiepe fundering, slieten',
  combined: 'Gecombineerde fundering',
  other: 'Overig',
};

export const RELIABILITY: Record<string, string> = {
  established: 'vastgesteld',
  cluster: 'afgeleid (cluster)',
  supercluster: 'afgeleid (supercluster)',
  indicative: 'indicatief',
};

export const RECOVERY_TYPE: Record<string, string> = {
  table: 'Tafelfundering',
  beam_on_pile: 'Opzetters',
  pile_lowering: 'Paalkopverlaging',
  pile_in_wall: 'Paalinkassing (in muur)',
  injection: 'Grondinjectie/verbetering',
  unknown: 'Onbekend',
};

export const RISK: Record<string, string> = {
  a: 'A (Geen risico)',
  b: 'B (Laag risico)',
  c: 'C (Verhoogd risico)',
  d: 'D (Hoog risico)',
  e: 'E (Aanzienlijk hoog risico)',
};

export const INQUIRY_TYPE: Record<string, string> = {
  additional_research: 'Aanvullend onderzoek',
  monitoring: 'Monitoring',
  note: 'Notitie',
  quickscan: 'QuickScan',
  unknown: 'Onbekend',
  demolition_research: 'Sloopgrensonderzoek',
  second_opinion: 'Second opinion',
  archive_research: 'Archiefonderzoek',
  archieve_research: 'Archiefonderzoek',
  architectural_research: 'Bouwkundig onderzoek',
  foundation_advice: 'Funderingsadvies',
  inspectionpit: 'Onderzoeksput',
  foundation_research: 'Funderingsonderzoek',
  ground_water_level_research: 'Grondwateronderzoek',
  soil_investigation: 'Grondonderzoek',
  facade_scan: 'Gevelscan',
};

export const DAMAGE_CAUSE: Record<string, string> = {
  drainage: 'Te lage grondwaterstand',
  construction_flaw: 'Constructiefouten',
  drystand: 'Droogstand houten paalkop',
  overcharge: 'Overbelasting',
  overcharge_negative_cling: 'Overbelasting en/of negatieve kleef',
  negative_cling: 'Negatieve kleef',
  bio_infection: 'Bacteriële aantasting (palenpest)',
  fungus_infection: 'Schimmelaantasting (paalrot)',
  bio_fungus_infection: 'Bacteriële en/of schimmelaantasting',
  foundation_flaw: 'Funderingsfouten',
  construction_heave: 'Opdrukking pand',
  subsidence: 'Verzakking',
  vegetation: 'Beschadiging fundering door planten en wortels',
  gas: 'Gaswinning',
  vibrations: 'Trillingen',
  partial_foundation_recovery: 'Partieel funderingsherstel',
  japanese_knotweed: 'Beschadiging fundering door Japanse duizendknoop',
  groundwater_level_reduction: 'Verlaging van grondwaterniveau',
};

export const OVERALL_QUALITY: Record<string, string> = {
  good: 'Goed',
  mediocre_good: 'Matig tot goed',
  tolerable: 'Redelijk',
  mediocre: 'Matig',
  mediocre_bad: 'Matig tot slecht',
  bad: 'Slecht',
};

export const ROOF_TYPE: Record<string, string> = {
  slanted: 'Schuin dak',
  'multiple horizontal': 'Meerdere platte daken',
  'single horizontal': 'Plat dak',
  horizontal: 'Plat dak',
  'could not detect': 'Onbekend',
  'no points': 'Onbekend',
  unknown: 'Onbekend',
};

export const WOOD_TYPE: Record<string, string> = { pine: 'Grenen', spruce: 'Vuren' };

export const CONSTRUCTION_PILE: Record<string, string> = {
  punched: 'Geperforeerd',
  broken: 'Gebroken',
  pinched: 'Verschoven',
  pressed: 'Gedrukt',
  perished: 'Vergaan',
  decay: 'Verrot',
  root_growth: 'Wortelgroei',
};

export const SUBSTRUCTURE: Record<string, string> = { cellar: 'Kelder', basement: 'Souterrain', crawlspace: 'Kruipruimte', none: 'Geen' };

export const WOOD_QUALITY: Record<string, string> = { area1: 'Gebied I', area2: 'Gebied II', area3: 'Gebied III', area4: 'Gebied IV' };
