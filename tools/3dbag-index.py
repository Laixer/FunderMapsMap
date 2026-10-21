"""Build the national index of 3D BAG leaf tiles (glb) with their lon/lat bounds.

Walks the public 3D BAG tileset (Cesium 3D Tiles 1.1), follows the nested tileset-*.json files and keeps every leaf
tile. The map loads this index once and picks the tiles in view; nothing else about 3D BAG is precomputed.

usage: python3 tools/3dbag-index.py [version] [lod]        (defaults v20250903 lod22)
       -> public/3dbag/<version>-<lod>.json   ({version, lod, base, tiles: [[uri, west, south, east, north], ...]})
"""
import json
import math
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v20250903'
LOD = sys.argv[2] if len(sys.argv) > 2 else 'lod22'
BASE = f'https://data.3dbag.nl/{VERSION}/cesium3dtiles/{LOD}/'
OUT = Path(__file__).resolve().parent.parent / 'public' / '3dbag' / f'{VERSION}-{LOD}.json'


def fetch(name):
    with urllib.request.urlopen(BASE + name, timeout=120) as r:
        return json.load(r)


def geodetic(x, y, z):
    """ECEF metres -> lon, lat in degrees (WGS84)."""
    a, e2 = 6378137.0, 6.69437999014e-3
    b = a * math.sqrt(1 - e2)
    ep2 = (a * a - b * b) / (b * b)
    p = math.hypot(x, y)
    th = math.atan2(z * a, p * b)
    lat = math.atan2(z + ep2 * b * math.sin(th) ** 3, p - e2 * a * math.cos(th) ** 3)
    return math.degrees(math.atan2(y, x)), math.degrees(lat)


def obb_bounds(bv):
    """Lon/lat box around a 3D Tiles oriented bounding box (centre + three half-axes)."""
    c, u, v, w = bv[0:3], bv[3:6], bv[6:9], bv[9:12]
    pts = [geodetic(*[c[i] + su * u[i] + sv * v[i] + sw * w[i] for i in range(3)])
           for su in (-1, 1) for sv in (-1, 1) for sw in (-1, 1)]
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    return [round(min(lons), 6), round(min(lats), 6), round(max(lons), 6), round(max(lats), 6)]


def walk(node, prefix, leaves, nested):
    uri = node.get('content', {}).get('uri')
    if uri and uri.endswith('.json'):
        nested.append((prefix + uri, prefix + uri.rsplit('/', 1)[0] + '/' if '/' in uri else prefix))
        return
    if uri:
        leaves.append([prefix + uri, *obb_bounds(node['boundingVolume']['box'])])
    for child in node.get('children', []):
        walk(child, prefix, leaves, nested)


def main():
    leaves, todo = [], [('tileset.json', '')]
    with ThreadPoolExecutor(max_workers=8) as pool:
        while todo:
            docs = list(pool.map(lambda t: (fetch(t[0]), t[1]), todo))
            todo = []
            for doc, prefix in docs:
                walk(doc['root'], prefix, leaves, todo)
            print(f'  {len(leaves)} leaves so far, {len(todo)} nested tilesets to fetch', file=sys.stderr)
    leaves.sort(key=lambda t: t[0])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({'version': VERSION, 'lod': LOD, 'base': BASE, 'tiles': leaves}, separators=(',', ':')))
    print(f'{VERSION} {LOD}: {len(leaves)} leaf tiles -> {OUT} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
