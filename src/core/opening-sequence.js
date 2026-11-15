'use strict';
const clamp = (n,a,b) => Math.min(Math.max(n,a),b);
const ELEMENTS = ['screen','camera','stickers'];
function defaultOpening() {
  return { isEnabled: false, preset: 'light3D', motionCurve: 'swift', duration: 2.2, stagger: 0.16,
    includedElements: [...ELEMENTS], elementOrder: [...ELEMENTS] };
}
function normalizeOpening(sequence = {}) {
  const result = { ...defaultOpening(), ...sequence };
  result.duration = clamp(Number.isFinite(result.duration) ? result.duration : 2.2,0.4,8);
  result.includedElements = [...new Set(result.includedElements)].filter((v) => ELEMENTS.includes(v));
  result.elementOrder = [...new Set([...result.elementOrder,...ELEMENTS])].filter((v) => ELEMENTS.includes(v));
  const maximum = result.includedElements.length > 1 ? (result.duration-0.18)/(result.includedElements.length-1) : 1.2;
  result.stagger = clamp(Number.isFinite(result.stagger) ? result.stagger : 0.16,0,Math.min(1.2,maximum));
  return result;
}
function elementProgress(x, curve) {
  x = clamp(x,0,1);
  return curve === 'smooth' ? x*x*x*(x*(x*6-15)+10) : 1-(1-x)**(curve === 'gentle' ? 3 : 4);
}
function openingSample(sequence, element, time, width, height, available) {
  const identity = { opacity:1,scale:1,offset:{x:0,y:0},rotationX:0,rotationY:0,perspective:0 };
  const s = normalizeOpening(sequence);
  const active = s.elementOrder.filter((v) => s.includedElements.includes(v) && available.includes(v));
  const index = active.indexOf(element);
  if (!s.isEnabled || time >= s.duration || index < 0) return identity;
  const stagger = Math.min(s.stagger,active.length > 1 ? (s.duration-0.18)/(active.length-1) : 1.2);
  const duration = Math.max(s.duration-stagger*Math.max(active.length-1,0),0.18);
  const linear = clamp((time-stagger*index)/duration,0,1);
  const eased = elementProgress(linear,s.motionCurve), remaining=1-eased;
  const presets = {
    converge: { screen:[0.72,-1.05,-0.62],camera:[0.58,1.12,0.72],stickers:[0.62,-1.3,-0.7] },
    sideSlide: { screen:[0.94,-1.12,0],camera:[0.88,1.15,0],stickers:[0.9,-1.35,0] },
    light3D: { screen:[0.8,-1.05,0.08],camera:[0.72,1.1,0.16],stickers:[0.76,-1.3,-0.12] },
  };
  const [scale,x,y] = presets[s.preset][element];
  const overshoot = clamp(1+1.35*(linear-1)**3+0.35*(linear-1)**2,0,1.04);
  const rotation = s.preset === 'light3D' && element === 'screen' ? (1-linear)**1.5 : 0;
  return { opacity: elementProgress(Math.min(linear*1.65,1),s.motionCurve), scale:scale+(overshoot-scale)*eased,
    offset:{x:x*width*remaining,y:y*height*remaining},rotationX:9*rotation,rotationY:-22*rotation,perspective:0.72*rotation };
}
function openingRect(rect, sample) {
  const width=rect.width*sample.scale,height=rect.height*sample.scale;
  return { x:rect.x+(rect.width-width)/2+sample.offset.x,y:rect.y+(rect.height-height)/2+sample.offset.y,width,height };
}
module.exports = { defaultOpening, normalizeOpening, openingSample, openingRect };
