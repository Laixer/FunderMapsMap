// The prototype's foundation cutaway is not part of the 5.0 map (Yorick, 2026-10-21: "leave the cut-away out, we dont
// have that today either"). scene.ts keeps its hooks for it, so only the two shapes it refers to live here; nothing in
// the map builds a Cutaway, so that code path stays dormant. The full module is in the prototype (map3d-schiedam).
import type * as THREE from 'three';

export interface Footprint {
  /** wall-bottom segments x1, y1, x2, y2 (local metres) */
  segments: number[];
  min: [number, number];
  max: [number, number];
}

export interface Cutaway {
  group: THREE.Group;
  /** pit rectangle (local) and bottom z */
  pit: { minX: number; minY: number; maxX: number; maxY: number; bottom: number };
  levels: unknown[];
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}
