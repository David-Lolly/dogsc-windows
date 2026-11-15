'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectScreen } = require('../src/core/screen-projection');
const rect = { x: 10, y: 20, width: 640, height: 360 };

test('unrotated projection preserves the original rectangle', () => {
  assert.deepEqual(projectScreen(rect), [{ x: 10, y: 20, w: 1 }, { x: 650, y: 20, w: 1 },
    { x: 650, y: 380, w: 1 }, { x: 10, y: 380, w: 1 }]);
});
test('orthographic 90 degree Z rotation follows analytic corner positions', () => {
  const points = projectScreen(rect, { rotationZ: 90, perspective: 0 });
  for (const [i, expected] of [[0, [510, -120]], [1, [510, 520]], [2, [150, 520]], [3, [150, -120]]]) {
    assert.ok(Math.abs(points[i].x - expected[0]) < 1e-9);
    assert.ok(Math.abs(points[i].y - expected[1]) < 1e-9);
  }
});
test('perspective varies depth and remains finite over authored rotations', () => {
  for (let angle = -180; angle <= 180; angle += 5) {
    const points = projectScreen(rect, { rotationX: angle, rotationY: angle / 2, rotationZ: 12, perspective: 2 });
    assert.ok(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.w >= 0.12));
  }
  const points = projectScreen(rect, { rotationY: 30 });
  assert.notEqual(points[0].w, points[1].w);
});
