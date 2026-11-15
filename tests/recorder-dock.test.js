'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dockBounds, dragBounds } = require('../src/core/recorder-dock');

const work = { x: 0, y: 0, width: 1920, height: 1040 };

test('折叠以窗口中心为锚点，展开回到同一中心', () => {
  const bar = { x: 440, y: 880, width: 1040, height: 132 };
  const ball = dockBounds(bar, { collapsed: true, width: 160 }, work);
  assert.deepEqual(ball, { x: 880, y: 910, width: 160, height: 72 });
  assert.deepEqual(dockBounds(ball, { collapsed: false }, work), bar);
});

test('球靠近屏幕边缘时展开向内侧夹紧', () => {
  const ball = { x: 0, y: 900, width: 160, height: 72 };
  const bar = dockBounds(ball, { collapsed: false }, work);
  assert.equal(bar.x, 0);
  assert.equal(bar.width, 1040);
  const right = dockBounds({ x: 1760, y: 900, width: 160, height: 72 }, { collapsed: false }, work);
  assert.equal(right.x + right.width, 1920);
  const bottom = dockBounds({ x: 800, y: 968, width: 160, height: 72 }, { collapsed: false }, work);
  assert.equal(bottom.y + bottom.height, 1040);
});

test('多屏负原点工作区同样夹紧', () => {
  const left = { x: -1920, y: -200, width: 1920, height: 1040 };
  const bar = dockBounds({ x: -1920, y: 600, width: 160, height: 72 }, { collapsed: false }, left);
  assert.equal(bar.x, -1920);
  assert.ok(bar.y + bar.height <= 840);
});

test('拖动保持尺寸并限制在工作区内', () => {
  const start = { x: 100, y: 100, width: 160, height: 72 };
  assert.deepEqual(dragBounds(start, 50, -30, work), { x: 150, y: 70, width: 160, height: 72 });
  const out = dragBounds(start, 5000, 5000, work);
  assert.equal(out.x, 1760);
  assert.equal(out.y, 968);
  assert.equal(dragBounds(start, -999, -999, work).x, 0);
});
