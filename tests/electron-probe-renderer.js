'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { Preview } = require('../src/renderer/editor/preview');
const { makeProject } = require('../src/core/model');
const { orderedClips } = require('../src/core/zoom');
const { projectScreen, ProjectiveTextureProbe } = require('../experiments/screen-projection');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle(node) {
  const deadline = performance.now() + 10000;
  while (node.readyState < 2 || node.seeking) {
    if (performance.now() > deadline) throw new Error('video did not settle');
    await sleep(10);
  }
}

exports.run = async (output) => {
  const project = makeProject({ name: 'synthetic-only', media: {
    screen: { file: 'white.mp4', width: 640, height: 360, duration: 3, frameRate: 30 },
  }});
  const listeners = new Set();
  const store = { directory: output, project, zoomClips: orderedClips([]), pointerTrack: null,
    subscribe: (listener) => listeners.add(listener) };
  const preview = new Preview(store, document.getElementById('preview'), document.getElementById('wrap'));
  const node = preview.screen.node;
  await settle(node);
  preview.seek(1); await settle(node); preview.draw();
  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  let assignments = 0;
  Object.defineProperty(node, 'currentTime', {
    get() { return descriptor.get.call(this); },
    set(value) { assignments++; descriptor.set.call(this, value); },
  });
  const started = performance.now();
  for (let n = 0; n < 200; n++) {
    project.canvas.contentScale = 0.9 + (n % 20) / 100;
    project.canvas.contentPosition = { x: 0.3 + (n % 20) / 50, y: 0.5 };
    for (const listener of listeners) listener('project');
    preview.draw();
  }
  const elapsed = performance.now() - started;
  assert.equal(assignments, 0, 'appearance editing must not reposition media');
  preview.seek(2);
  // draw in the same task: decoding has not had an opportunity to complete.
  preview.draw();
  const pixel = preview.ctx.getImageData(preview.canvas.width >> 1, preview.canvas.height >> 1, 1, 1).data;
  assert.ok(pixel[0] > 220 && pixel[1] > 220 && pixel[2] > 220, 'seeking must retain the white source frame');
  for (const time of [0.2, 2.5, 0.7, 1.8]) preview.seek(time);
  const deadline = performance.now() + 10000;
  while (node.seeking || preview.screen.pendingTime != null || Math.abs(node.currentTime - 1.8) > 0.01) {
    if (performance.now() > deadline) throw new Error('latest scrub destination was not reached');
    await sleep(10);
  }
  const finalScrubTime = node.currentTime;
  preview.draw();
  fs.writeFileSync(path.join(output, 'preview.png'), Buffer.from(preview.canvas.toDataURL('image/png').split(',')[1], 'base64'));
  const projected = document.createElement('canvas'); projected.width = 960; projected.height = 540;
  const projection = new ProjectiveTextureProbe(projected);
  const quad = projectScreen({ x: 160, y: 90, width: 640, height: 360 }, { rotationX: 20, rotationY: -30, rotationZ: 8 });
  const texture = new OffscreenCanvas(128, 128), textureContext = texture.getContext('2d');
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  for (let i = 0; i < 4; i++) {
    textureContext.fillStyle = colors[i]; textureContext.fillRect((i % 2) * 64, Math.floor(i / 2) * 64, 64, 64);
  }
  projection.draw(texture, quad);
  const textureSamples = [];
  for (const [u, v, expected] of [[0.25, 0.25, [255, 0, 0]], [0.75, 0.25, [0, 255, 0]],
    [0.25, 0.75, [0, 0, 255]], [0.75, 0.75, [255, 255, 0]]]) {
    const weights = [(1-u)*(1-v), u*(1-v), u*v, (1-u)*v];
    const w = quad.reduce((sum, point, i) => sum + weights[i] * point.w, 0);
    const x = quad.reduce((sum, point, i) => sum + weights[i] * point.x * point.w, 0) / w;
    const y = quad.reduce((sum, point, i) => sum + weights[i] * point.y * point.w, 0) / w;
    const pixel = new Uint8Array(4);
    projection.gl.readPixels(Math.floor(x), projected.height - 1 - Math.floor(y), 1, 1, projection.gl.RGBA, projection.gl.UNSIGNED_BYTE, pixel);
    assert.ok(expected.every((value, channel) => Math.abs(value - pixel[channel]) < 3), 'perspective texture coordinates must preserve quadrants');
    textureSamples.push({ u, v, pixel: [...pixel] });
  }
  const outsidePixel = new Uint8Array(4);
  projection.gl.readPixels(0, 0, 1, 1, projection.gl.RGBA, projection.gl.UNSIGNED_BYTE, outsidePixel);
  assert.equal(outsidePixel[3], 0, 'outside quad must remain transparent');
  fs.writeFileSync(path.join(output, 'projection.png'), Buffer.from(projected.toDataURL('image/png').split(',')[1], 'base64'));
  projection.dispose();
  const { Compositor } = require('../src/renderer/editor/render');
  const { evaluateScene } = require('../src/core/scene');
  const cropProject = JSON.parse(JSON.stringify(project));
  cropProject.canvas.crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
  cropProject.canvas.padding = 0; cropProject.canvas.contentScale = 1;
  cropProject.canvas.contentPosition = { x: 0.5, y: 0.5 };
  const cropCanvas = new OffscreenCanvas(320, 180), cropCtx = cropCanvas.getContext('2d');
  const cropCompositor = new Compositor(output);
  const cropScene = evaluateScene(cropProject, { time: 0, width: 320, height: 180, sourceAspect: 1, zoomClips: [], pointerTrack: null });
  cropCompositor.draw(cropCtx, cropProject, cropScene, { screen: texture, camera: null });
  const cropPixel = [...cropCtx.getImageData(160, 90, 1, 1).data];
  assert.ok(cropPixel[0] > 250 && cropPixel[1] < 3 && cropPixel[2] < 3, 'product compositor must crop source pixels');
  const cameraCanvas = new OffscreenCanvas(128, 128), cameraCtx = cameraCanvas.getContext('2d');
  cropCompositor.drawCamera(cameraCtx, { rect: { x: 0, y: 0, width: 128, height: 128 }, borderWidth: 0, cornerRadius: 0,
    contentPosition: { x: 0, y: 0 }, contentScale: 2, isMirrored: true }, texture);
  const cameraPixel = [...cameraCtx.getImageData(64, 64, 1, 1).data];
  assert.ok(cameraPixel[0] > 250 && cameraPixel[1] < 3 && cameraPixel[2] < 3, 'camera content focus and zoom must preserve the selected source crop under mirroring');
  cropCompositor.dispose();
  project.canvas.background = { kind: 'color', color: '#123456' };
  project.timeline.screenMotionClips.push({ id: 'render-3d', timing: { startTime: 0.2, duration: 1.7,
    leadInDuration: 0.5, returnDuration: 0.6, easing: 'linear' }, target: { position: { x: 0.5, y: 0.5 },
    scale: 1, rotationX: 15, rotationY: -30, rotationZ: 8, perspective: 0.65 } });
  project.canvas.contentScale = 1; project.canvas.contentPosition = { x: 0.5, y: 0.5 };
  preview.seek(1); await settle(node); preview.draw();
  // Use equal output dimensions to compare both real decode paths through the
  // product compositor. Export uses VideoFrame, preview uses cached <video>.
  preview.canvas.width = 640; preview.canvas.height = 360; preview.draw();
  const previewPixels = preview.ctx.getImageData(0, 0, 640, 360).data;
  const { exportProject } = require('../src/renderer/editor/export');
  let difference = null;
  const exported = await exportProject({ project, directory: output, outputFile: path.join(output, 'screen-3d.mp4'),
    resolution: 'source', frameRate: 30, frameHook: (n, canvas) => {
      if (n !== 30) return;
      const pixels = canvas.getContext('2d').getImageData(0, 0, 640, 360).data;
      let total = 0;
      for (let i = 0; i < pixels.length; i++) total += Math.abs(pixels[i] - previewPixels[i]);
      difference = total / pixels.length;
      assert.ok(difference < 1, '3D preview and export must use identical geometry and composition');
    } });
  assert.equal(exported.frames, 90);
  assert.notEqual(difference, null);
  return { passed: true, syntheticMediaOnly: true, appearanceUpdates: 200, appearanceSeekAssignments: 0,
    appearanceDrawSubmissionMs: elapsed, retainedPixelDuringSeek: [...pixel], finalScrubTime,
    totalSeekAssignments: assignments, projectiveTexture: { passed: true, quad, textureSamples, outsidePixel: [...outsidePixel], integratedInEditor: true },
    screen3DExport: { passed: true, frames: exported.frames, duration: exported.duration, meanPixelDifferenceBeforeEncoding: difference, encoder: exported.encoder },
    layoutRendering: { cropPassed: true, cropPixel, cameraContentPassed: true, cameraPixel },
    note: 'GPU submission timing is not a frame-rate benchmark; Mac visual parity not tested.' };
};
