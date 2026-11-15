'use strict';
const { CAMERA_SHAPES } = require('./model');
const { targetTransition } = require('./effect-timing');
const mix = (a,b,t) => a+(b-a)*t;
function resolveCamera(state, sourceAspect, canvasAspect) {
  const fullscreen = state.layout.kind === 'fullscreen';
  const shape = CAMERA_SHAPES[state.layout.shape] || CAMERA_SHAPES.square;
  return { position: state.position, size: state.size, aspectRatio: fullscreen ? canvasAspect : shape.aspect || sourceAspect,
    cornerFraction: fullscreen ? 0 : state.layout.shape === 'circle' ? 0.5 : 0.5*state.roundness,
    fullscreenProgress: fullscreen ? 1 : 0, opacity: state.opacity };
}
function sampleCameraMotion(project, time, sourceAspect, canvasAspect) {
  const style = project.camera;
  const base = { layout: { kind: 'shape', shape: style.shape }, position: style.position,
    size: style.size, roundness: style.roundness, opacity: style.isHidden ? 0 : 1 };
  const transition = targetTransition(project.timeline.cameraMotionClips, time, base, project.motion);
  const a = resolveCamera(transition.from, sourceAspect, canvasAspect), b = resolveCamera(transition.to, sourceAspect, canvasAspect);
  const t = transition.progress;
  if (b.opacity < 0.01) return { ...a, opacity: mix(a.opacity, 0, t) };
  if (a.opacity < 0.01) return { ...b, opacity: mix(0, b.opacity, t) };
  const value = { position: { x: mix(a.position.x,b.position.x,t), y: mix(a.position.y,b.position.y,t) } };
  for (const key of ['size','aspectRatio','cornerFraction','fullscreenProgress','opacity']) value[key] = mix(a[key],b[key],t);
  return value;
}
module.exports = { sampleCameraMotion };
