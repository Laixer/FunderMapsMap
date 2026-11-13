// The door to the 3D engine: the scene three.js draws, the workers that convert the 3D tiles and the walk over the 3D
// tileset. The map loads this module with import(), the first time the 3D view is shown (map/controller.ts, load3d), so
// the build keeps it and three.js apart from the page's own script: a 2D map (a phone, a device without a GPU,
// "3D-panden" off) downloads none of it. Nothing else may import this module, or one behind it, for more than a type.
import { BuildingLayer } from './scene';
import { TileWorkers } from './workers';
import { Bag3dTileset } from './bag3d-tileset';
import type { Frame } from './frame';

export interface Engine3d {
  /** convert the 3D tiles off the main thread */
  workers: TileWorkers;
  /** finds the 3D tiles that cover a view */
  tileset: Bag3dTileset;
  /** a new, empty 3D layer around a frame origin */
  makeLayer(frame: Frame): BuildingLayer;
}

/** base and root: where the 3D tileset is (BUILDINGS_3D in config.ts). The workers start at once. */
export function createEngine3d(base: string, root: string): Engine3d {
  return {
    workers: new TileWorkers(2),
    tileset: new Bag3dTileset(base, root),
    makeLayer: (frame) => new BuildingLayer(frame),
  };
}
