"""Freeze the current map app's layer rules and the database legends into the map (read-only on both).

usage: python3 tools/freeze-rules.py <WebFront src/config/layers dir> <legends.json from the DB>
  - src/engine/rules.json       per building layer (fill-extrusion on buildings, facade_scan, incident): {filter, color}
  - src/engine/legends.json     every legend row of application.mapset_layer (name + fields), minus retired layers
  - src/config/area-layers.json the area layers (building blocks, incidents per buurt/wijk/gemeente) as MapLibre layers

The legends JSON comes from:  SELECT json_object_agg(id, json_build_object('name', name, 'fields', fields) ORDER BY id)
FROM application.mapset_layer;
"""
import json, sys
from pathlib import Path

layers_dir, legends_file = Path(sys.argv[1]), Path(sys.argv[2])
root = Path(__file__).resolve().parent.parent
RETIRED = {'foundation-candidate'}  # not in the map app any more (WebFront #334)

rules, areas = {}, {}
for f in sorted(layers_dir.glob('*.json')):
    layer = json.loads(f.read_text())
    if layer.get('type') == 'fill-extrusion':
        flt = layer.get('filter')
        # the map merges all per-building sources onto one object per pand (data-worker.ts); a layer that only drew
        # because its own source held just those buildings gets the flag the worker sets for that source
        if layer.get('source') == 'incident':
            flt = ['all', ['has', 'incident'], flt] if flt else ['has', 'incident']
        # source + sourceFilter: how the layer draws on its own tiles (flat mode does exactly that)
        rules[layer['id']] = {'filter': flt, 'color': layer['paint']['fill-extrusion-color'],
                              'source': layer.get('source'), 'sourceFilter': layer.get('filter')}
    else:
        areas[layer['id']] = {k: v for k, v in layer.items() if k != 'metadata'}
legends = {k: v for k, v in json.loads(legends_file.read_text()).items() if k not in RETIRED}

(root / 'src/engine/rules.json').write_text(json.dumps(rules, indent=1, ensure_ascii=False) + '\n')
(root / 'src/engine/legends.json').write_text(json.dumps(legends, indent=1, ensure_ascii=False) + '\n')
(root / 'src/config').mkdir(exist_ok=True)
(root / 'src/config/area-layers.json').write_text(json.dumps(areas, indent=1, ensure_ascii=False) + '\n')
missing = sorted(set(rules) | set(areas)) and sorted((set(rules) | set(areas)) - set(legends))
print(f'{len(rules)} building rules, {len(areas)} area layers, {len(legends)} legends; layers without a legend: {missing or "none"}')
