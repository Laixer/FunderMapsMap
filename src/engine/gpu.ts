// Whether the browser draws WebGL in software: no GPU (SwiftShader, llvmpipe) or a remote desktop. Such a device gets
// the 2D map, so the map asks this before, and without, the 3D engine; the 3D layer asks the same of the same context.
export function softwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext | null): boolean {
  if (!gl) return false;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu);
}
