'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeProject, normalizeProject, validateProjectContract } = require('../src/core/model');
const { sampleScreenMotion } = require('../src/core/screen-motion');
const { evaluateScene } = require('../src/core/scene');

const project = () => makeProject({ name: 'motion', media: { screen: { width: 1920, height: 1080, duration: 10 } } });
const clip = (id, start, rotationY, returnDuration = 1) => ({ id,
  timing: { startTime: start, duration: 2, leadInDuration: 1, returnDuration, easing: 'linear' },
  target: { position: { x: 0.5, y: 0.5 }, scale: 1, rotationX: 0, rotationY, rotationZ: 0, perspective: 0.65 } });
const viewport = { width: 1920, height: 1080, fittedWidth: 1600, fittedHeight: 900, borderWidth: 0 };
const sample = (p, t) => sampleScreenMotion(p.timeline.screenMotionClips, t, p.canvas, p.motion, viewport);

test('screen motion enters, holds, returns to the base and survives serialization', () => {
  const p = project(); p.timeline.screenMotionClips = [clip('a', 1, 40)];
  const restored = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(sample(restored, 0).state.rotationY, 0);
  assert.equal(sample(restored, 1.5).state.rotationY, 20);
  assert.equal(sample(restored, 2.5).state.rotationY, 40);
  assert.equal(sample(restored, 3.5).state.rotationY, 20);
  assert.equal(sample(restored, 4).state.rotationY, 0);
});
test('touching clips inherit directly without dropping to the base between targets', () => {
  const p = project(); p.timeline.screenMotionClips = [clip('a', 1, 40), clip('b', 3, -20)];
  validateProjectContract(p);
  assert.equal(sample(p, 3).state.rotationY, 40);
  assert.equal(sample(p, 3.5).state.rotationY, 10);
  assert.equal(sample(p, 4).state.rotationY, -20);
});
test('invalid and conflicting authored clips cannot be saved', () => {
  const p = project(); p.timeline.screenMotionClips = [clip('a', 1, 40), clip('b', 2, -20)];
  assert.throws(() => validateProjectContract(p), /重叠/);
  p.timeline.screenMotionClips = [clip('a', 1, NaN)];
  assert.throws(() => normalizeProject(p), /参数无效/);
});
test('scene geometry is resolution independent and includes projective corners', () => {
  const p = project(); p.timeline.screenMotionClips = [clip('a', 1, 40)];
  const scene = (factor) => evaluateScene(p, { time: 2.5, width: 1920*factor, height: 1080*factor,
    sourceAspect: 16/9, zoomClips: [], pointerTrack: null });
  const full = scene(1), half = scene(0.5);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(full.screen.quad[i].x / 2 - half.screen.quad[i].x) < 1e-9);
    assert.ok(Math.abs(full.screen.quad[i].y / 2 - half.screen.quad[i].y) < 1e-9);
  }
});
