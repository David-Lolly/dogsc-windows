'use strict';
// RecorderCore/CameraContentFill.swift: fill, 1% overscan and authored focus.
function cameraContentLayout(source, target, focus = { x: 0.5, y: 0.5 }, contentScale = 1) {
  if (![source.width, source.height, target.width, target.height].every((v) => Number.isFinite(v) && v > 0)) return null;
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
  const scale = Math.max(target.width / source.width, target.height / source.height) * 1.01 * clamp(Number.isFinite(contentScale) ? contentScale : 1, 1, 4);
  const x = clamp(Number.isFinite(focus.x) ? focus.x : 0.5, 0, 1);
  const y = clamp(Number.isFinite(focus.y) ? focus.y : 0.5, 0, 1);
  const width = source.width * scale, height = source.height * scale;
  return { x: target.x - (width - target.width) * x, y: target.y - (height - target.height) * y, width, height };
}
module.exports = { cameraContentLayout };
