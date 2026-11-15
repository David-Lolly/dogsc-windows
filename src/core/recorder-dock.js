'use strict';
// 录制条折叠/展开的窗口矩形换算：以当前窗口中心为锚点改变尺寸，并夹在所在屏幕的工作区内。

const EXPANDED = { width: 1040, height: 132 };
const COLLAPSED_HEIGHT = 72;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

function resizeAround(bounds, size, workArea) {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: Math.round(clamp(centerX - width / 2, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(centerY - height / 2, workArea.y, workArea.y + workArea.height - height)),
    width, height,
  };
}

function dockBounds(bounds, { collapsed, width }, workArea) {
  const size = collapsed ? { width: Math.max(1, Math.round(width)), height: COLLAPSED_HEIGHT } : EXPANDED;
  return resizeAround(bounds, size, workArea);
}

// 拖动时保持窗口尺寸，只平移并保证不被拖出屏幕工作区。
function dragBounds(start, dx, dy, workArea) {
  return {
    x: Math.round(clamp(start.x + dx, workArea.x, workArea.x + workArea.width - start.width)),
    y: Math.round(clamp(start.y + dy, workArea.y, workArea.y + workArea.height - start.height)),
    width: start.width, height: start.height,
  };
}

module.exports = { EXPANDED, COLLAPSED_HEIGHT, resizeAround, dockBounds, dragBounds };
