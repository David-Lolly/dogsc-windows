'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeProject, normalizedCrop, canvasDimensions } = require('../src/core/model');
const { evaluateScene } = require('../src/core/scene');
const { cameraContentLayout } = require('../src/core/camera-content');
const project = () => makeProject({ name: 'layout', media: { screen: { width: 1920, height: 1080, duration: 10 } } });

test('source resolution follows cropped pixels, custom ratio fits without upscaling', () => {
  const p = project(); p.canvas.crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
  assert.deepEqual(canvasDimensions(p.canvas, 'source', p.media.screen), { width: 960, height: 1080 });
  p.canvas.aspectRatio = 'custom'; p.canvas.customAspectRatio = { width: 2, height: 1 };
  assert.deepEqual(canvasDimensions(p.canvas, 'source', p.media.screen), { width: 960, height: 480 });
  assert.deepEqual(canvasDimensions(p.canvas, 'fullHD', p.media.screen), { width: 1920, height: 960 });
  p.canvas.aspectRatio = 'cinemaPortrait';
  assert.deepEqual(canvasDimensions(p.canvas, 'fullHD', p.media.screen), { width: 804, height: 1920 });
});
test('cropped cursor coordinates map into the visible source and exclude hidden content', () => {
  const p = project(); p.canvas.crop = { x: 0.25, y: 0.2, width: 0.5, height: 0.6 };
  let position = { x: 0.5, y: 0.5 };
  const pointerTrack = { evaluation: () => ({ cursor: { location: position, recordedCursor: 'arrow' } }) };
  const evaluate = () => evaluateScene(p, { time: 0, width: 1920, height: 1080, sourceAspect: 16/9, zoomClips: [], pointerTrack });
  const scene = evaluate();
  assert.ok(Math.abs(scene.cursor.x - (scene.screen.finalRect.x + scene.screen.finalRect.width/2)) < 1e-9);
  assert.ok(Math.abs(scene.cursor.y - (scene.screen.finalRect.y + scene.screen.finalRect.height/2)) < 1e-9);
  position = { x: 0.1, y: 0.5 };
  assert.equal(evaluate().cursor, null);
});
test('crop extremes preserve a nonzero aperture', () => {
  const crop = normalizedCrop({ x: 1, y: 1, width: -4, height: -4 });
  assert.equal(crop.x, 0.98); assert.equal(crop.y, 0.98);
  assert.ok(crop.width >= 0.02-1e-9 && crop.height >= 0.02-1e-9);
});
test('camera content focus pans only the content and keeps the aperture covered', () => {
  const source = { width: 1920, height: 1080 }, target = { x: 100, y: 200, width: 300, height: 300 };
  const left = cameraContentLayout(source, target, { x: 0, y: 0.5 }, 2);
  const right = cameraContentLayout(source, target, { x: 1, y: 0.5 }, 2);
  assert.equal(left.x, target.x);
  assert.ok(Math.abs(right.x + right.width - target.x - target.width) < 1e-9);
  assert.ok(left.y <= target.y && left.y + left.height >= target.y + target.height);
  assert.ok(left.width > target.width && left.height > target.height);
});
