'use strict';
// 项目模型与默认值。字段名与默认数值对齐 macOS 版 RecorderCore/ProjectModel.swift，
// 所有视觉尺寸按 1080 短边设计（见 scene.js 的 canonicalStyleScale）。

const { randomUUID } = require('node:crypto');
const { defaultOpening, normalizeOpening } = require('./opening-sequence');

const clamp = (value, lower, upper) => Math.min(Math.max(value, lower), upper);
const even = (value) => Math.max(Math.round(value / 2) * 2, 2);

const ASPECT_RATIOS = {
  adaptive: { label: '适应', ratio: null },
  landscape: { label: '16:9', ratio: 16 / 9 },
  standard: { label: '4:3', ratio: 4 / 3 },
  portrait: { label: '9:16', ratio: 9 / 16 },
  square: { label: '1:1', ratio: 1 },
  standardPortrait: { label: '3:4', ratio: 3 / 4 },
  cinema: { label: '2.39:1', ratio: 2.39 },
  cinemaPortrait: { label: '1:2.39', ratio: 1 / 2.39 },
  custom: { label: '自定义', ratio: null },
};

const RESOLUTIONS = {
  source: { label: '原始素材', short: null, long: null },
  fullHD: { label: '1080p', short: 1080, long: 1920 },
  quadHD: { label: '1440p', short: 1440, long: 2560 },
  ultraHD: { label: '4K', short: 2160, long: 3840 },
};

const PATTERN_PRESETS = {
  obsidianGrid: { label: '黑曜石网格', background: '#0F0F0F', stroke: '#3D3D3D', kind: 'grid', fraction: 0.0425 },
  engineeringWhiteGrid: { label: '工程白网格', background: '#F7F7F7', stroke: '#C9C9C9', kind: 'grid', fraction: 0.040 },
  midnightDots: { label: '暗夜星阵', background: '#111111', dot: 'rgba(194,173,138,0.90)', kind: 'dots', fraction: 0.032 },
  architecturalDots: { label: '建筑极简点', background: '#F9F9F9', dot: 'rgba(148,148,148,0.75)', kind: 'dots', fraction: 0.030 },
  isometricMesh: { label: '立体等角网', background: '#131313', stroke: '#4F4A42', kind: 'iso', fraction: 0.050 },
};

const CAMERA_SHAPES = {
  square: { label: '方形', aspect: 1 },
  horizontal: { label: '横向', aspect: 1.5 },
  vertical: { label: '纵向', aspect: 0.72 },
  original: { label: '原始比例', aspect: null },
  circle: { label: '圆形', aspect: 1 },
};

const CLICK_EFFECTS = {
  ripple: { label: '涟漪扩散', duration: 0.36 },
  glow: { label: '柔和光晕', duration: 0.32 },
  pulse: { label: '弹性双环', duration: 0.38 },
  burst: { label: '聚焦微闪', duration: 0.22 },
  none: { label: '无效果', duration: 0 },
};

const ZOOM_EASINGS = {
  linear: '线性', quadratic: '二次方缓动', cubic: '三次方缓动', quintic: '五次平滑', spring: '弹簧',custom:'自定义曲线',
};

function defaultCanvas() {
  return {
    aspectRatio: 'adaptive',
    customAspectRatio: { width: 16, height: 9 },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    background: { kind: 'pattern', preset: 'obsidianGrid' },
    backgroundBlur: 0,
    padding: 100,
    contentScale: 1,
    contentPosition: { x: 0.5, y: 0.5 },
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: '#FFFFFF',
    shadowStrength: 0.28,
    screenFrame:'none',screenFrameScale:1,screenFrameToolbarScale:1,screenFrameTitle:'DogSC',screenFrameBrowserAddress:'https://example.com',
    screenFrameOuterCornerRadius:null,screenFrameContentCornerRadius:null,screenFrameInsetOpacity:1,
    patternScale: 1,
    patternOpacity: 1,
  };
}

function defaultCamera() {
  return {
    shape: 'square',
    position: { x: 0.96, y: 0.47 },
    size: 0.29,
    borderWidth: 3,
    shadowStrength: 0.25,
    roundness: 0.5,
    isMirrored: true,
    isHidden: false,
    scaleDuringZoom: 0.7,
    contentPosition: { x: 0.5, y: 0.5 },
    contentScale: 1,
  };
}

function defaultCursorStyle() {
  return {
    appearance: 'automatic', // automatic | arrow | pointingHand | hidden
    size: 1.25,
    hideWhenIdle: false,
    idleDelay: 1.2,
    clickEffectStyle: 'ripple',
    clickColor: null,
    clickOpacity: 0.8,
    clickScale: 1,
    timeOffset: 0, // 光标时间校准（秒），不改变平滑参数
    motionTiltStrength: 2,
  };
}

function defaultMotion() {
  return {
    cursor: 'smooth', // smooth | none
    screenSpringMass: 2.4,
    screenSpringStiffness: 210,
    screenSpringDamping: 42,
    cursorSpringMass: 2.8,
    cursorSpringStiffness: 450,
    cursorSpringDamping: 66,
    defaultZoomEasing: 'spring',
    defaultZoomTransitionDuration: 0.7,
    defaultZoomScale: 1.6,
  };
}

function defaultAudio() {
  return { systemVolume: 0.82, microphoneVolume: 0.9, isSystemMuted: false, isMicrophoneMuted: false };
}

function makeProject({ name, media, capture }) {
  const duration = media.screen.duration;
  return {
    schema: 2,
    app: 'dogsc-windows',
    name,
    createdAt: new Date().toISOString(),
    media,
    capture,
    canvas: defaultCanvas(),
    camera: defaultCamera(),
    cursorStyle: defaultCursorStyle(),
    motion: defaultMotion(),
    audio: defaultAudio(),
    openingSequence: defaultOpening(),
    zoomAnimations: [],
    timeline: { segments: [{ id: randomUUID(), sourceStart: 0, sourceEnd: duration, speed: 1 }],
      screenMotionClips: [], cameraMotionClips: [], mosaicClips: [], stickerClips: [] },
    markers: [],
    export: { kind: 'video', resolution: 'source', frameRate: 60 },
  };
}

/// 旧项目补默认值；新增字段在这里兜底，不改用户已保存的值。
function normalizeProject(project) {
  validateProjectContract(project);
  const merge = (defaults, value) => ({ ...defaults, ...(value || {}) });
  project.canvas = merge(defaultCanvas(), project.canvas);
  project.camera = merge(defaultCamera(), project.camera);
  project.cursorStyle = merge(defaultCursorStyle(), project.cursorStyle);
  project.motion = merge(defaultMotion(), project.motion);
  project.audio = merge(defaultAudio(), project.audio);
  project.openingSequence = normalizeOpening(project.openingSequence);
  project.zoomAnimations = project.zoomAnimations || [];
  project.markers = project.markers || [];
  project.export = merge({ kind: 'video', resolution: 'source', frameRate: 60 }, project.export);
  if (!project.timeline || !project.timeline.segments || !project.timeline.segments.length) {
    project.timeline = { segments: [{ id: randomUUID(), sourceStart: 0, sourceEnd: project.media.screen.duration, speed: 1 }] };
  }
  for (const key of ['screenMotionClips', 'cameraMotionClips', 'mosaicClips', 'stickerClips']) {
    if (project.timeline[key] === undefined) project.timeline[key] = [];
  }
  project.schema = project.schema===3?3:2;
  return project;
}

// A Mac v27 project is not this Windows schema. Reject incompatible files
// before adding defaults or autosaving them as a different project format.
function validateProjectContract(project) {
  if (!project || project.app !== 'dogsc-windows' || ![1, 2, 3].includes(project.schema)) {
    throw new Error('项目格式尚不兼容：当前支持 Windows schema 1/2/3 项目。Mac 工程和其他版本不会被转换或覆盖。');
  }
  const screen = project.media && project.media.screen;
  for(const key of ['screenFrameOuterCornerRadius','screenFrameContentCornerRadius']){const value=project.canvas?.[key];if(value!=null&&(!Number.isFinite(value)||value<0||value>200))throw new Error('装饰框圆角参数无效。');}
  const insetOpacity=project.canvas?.screenFrameInsetOpacity;if(insetOpacity!==undefined&&(!Number.isFinite(insetOpacity)||insetOpacity<0||insetOpacity>1))throw new Error('装饰框透明度无效。');
  if (!screen || ![screen.width, screen.height, screen.duration].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('项目屏幕素材的尺寸或时长无效。');
  }
  for (const key of ['screenMotionClips', 'cameraMotionClips', 'mosaicClips', 'stickerClips']) {
    if (project.timeline && project.timeline[key] !== undefined && !Array.isArray(project.timeline[key])) throw new Error(`无效效果轨道：${key}`);
  }
  const clips = project.timeline && project.timeline.screenMotionClips || [];
  const ordered = [...clips].sort((a, b) => (a.timing?.startTime || 0) - (b.timing?.startTime || 0));
  const ids = new Set();
  for (let i = 0; i < ordered.length; i++) {
    const { id, timing: t, target: s } = ordered[i];
    const range = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
    if (typeof id !== 'string' || ids.has(id) || !t || !s || !range(t.startTime, 0, screen.duration)
      || !range(t.duration, 0.01, screen.duration) || t.startTime + t.duration > screen.duration + 1e-6
      || !range(t.leadInDuration, 0, t.duration) || !range(t.returnDuration, 0, 10)
      || !Object.hasOwn(ZOOM_EASINGS, t.easing) || !s.position || !range(s.position.x, 0, 1) || !range(s.position.y, 0, 1)
      || !range(s.scale, 0.2, 4) || !range(s.perspective, 0, 2)
      || !['rotationX', 'rotationY', 'rotationZ'].every((key) => range(s[key], -180, 180))) throw new Error('屏幕 3D 片段参数无效。');
    ids.add(id);
    const next = ordered[i + 1];
    if (next) {
      const gap = next.timing.startTime - t.startTime - t.duration;
      if (gap < -1e-6 || (gap > 1 / 120 && gap < t.returnDuration - 1e-6)) throw new Error('屏幕 3D 片段或退出过渡相互重叠。');
    }
  }
  const validRange = (v,a,b) => Number.isFinite(v) && v >= a && v <= b;
  const segmentIDs=new Set();
  for(const s of project.timeline?.segments||[]){
    if(typeof s.id!=='string'||segmentIDs.has(s.id)||!validRange(s.sourceStart,0,screen.duration)||!validRange(s.sourceEnd,s.sourceStart+0.001,screen.duration)||!validRange(s.speed,0.25,8))throw new Error('主片段参数无效。');segmentIDs.add(s.id);
    if(s.audio)for(const[k,v]of Object.entries(s.audio)){if(['systemVolume','microphoneVolume'].includes(k)&&!validRange(v,0,1))throw new Error('片段音量无效。');if(['isSystemMuted','isMicrophoneMuted'].includes(k)&&typeof v!=='boolean')throw new Error('片段静音值无效。');}
  }
  for(const key of ['camera','microphone','systemAudio']){
    const ref=project.media[key];if(!ref)continue;
    if(ref.sourceTimeScale!==undefined&&!validRange(ref.sourceTimeScale,0.1,8))throw new Error('媒体时钟速率无效。');
    if(ref.sourceStartTime!==undefined&&!validRange(ref.sourceStartTime,0,ref.duration))throw new Error('媒体源裁剪无效。');
    if(ref.sourceEndTime!==undefined&&!validRange(ref.sourceEndTime,ref.sourceStartTime||0,ref.duration))throw new Error('媒体结束边界无效。');
    if(ref.syncAnchors!==undefined&&!Array.isArray(ref.syncAnchors))throw new Error('媒体同步锚点无效。');
    let previous={sourceTime:0,offset:0};
    for(const a of [...(ref.syncAnchors||[])].sort((a,b)=>a.sourceTime-b.sourceTime)){
      if(!validRange(a.sourceTime,0,screen.duration)||!validRange(a.offset,-10,10))throw new Error('媒体同步锚点无效。');
      if(a.sourceTime>previous.sourceTime&&((ref.sourceTimeScale??1)+(a.offset-previous.offset)/(a.sourceTime-previous.sourceTime))<=0)throw new Error('媒体同步曲线必须保持时间向前。');
      previous=a;
    }
  }
  for(const item of [...(project.zoomAnimations||[]),...(project.timeline?.screenMotionClips||[]).map(c=>c.timing),...(project.timeline?.cameraMotionClips||[]).map(c=>c.timing)])if(item.customCurve&&['x1','y1','x2','y2'].some(k=>!validRange(item.customCurve[k],0,1)))throw new Error('自定义曲线控制点无效。');
  const cameraClips = [...(project.timeline?.cameraMotionClips || [])].sort((a,b)=>a.timing?.startTime-b.timing?.startTime);
  const cameraIDs = new Set();
  for (let i=0;i<cameraClips.length;i++) {
    const { id, timing:t, target:s } = cameraClips[i];
    if (typeof id !== 'string' || cameraIDs.has(id) || !t || !s || !validRange(t.startTime,0,screen.duration)
      || !validRange(t.duration,0.01,screen.duration) || t.startTime+t.duration>screen.duration+1e-6
      || !validRange(t.leadInDuration,0,t.duration) || !validRange(t.returnDuration,0,10) || !Object.hasOwn(ZOOM_EASINGS,t.easing)
      || !s.position || !validRange(s.position.x,0,1) || !validRange(s.position.y,0,1)
      || !validRange(s.size,0.1,1.2) || !validRange(s.roundness,0,1) || !validRange(s.opacity,0,1)
      || !s.layout || !['shape','fullscreen'].includes(s.layout.kind)
      || (s.layout.kind === 'shape' && !Object.hasOwn(CAMERA_SHAPES,s.layout.shape))) throw new Error('摄像头运动片段参数无效。');
    cameraIDs.add(id);
    const next=cameraClips[i+1];
    if (next) { const gap=next.timing.startTime-t.startTime-t.duration;
      if (gap < -1e-6 || (gap > 1/120 && gap < t.returnDuration-1e-6)) throw new Error('摄像头运动片段或退出过渡相互重叠。'); }
  }
  for (const clip of [...clips,...(project.zoomAnimations || [])]) {
    const f=clip.focusEffect;
    if (!f) continue;
    if ((f.shape !== undefined && !['radial','linear'].includes(f.shape)) || !['animation','pointer','fixed'].includes(f.target)
      || !f.center || !validRange(f.center.x,0,1) || !validRange(f.center.y,0,1) || !validRange(f.size,0.1,1)
      || !['blur','softness','dimming'].every((key)=>validRange(f[key],0,1))
      || (f.angleDegrees !== undefined && !validRange(f.angleDegrees,0,360))) throw new Error('聚焦效果参数无效。');
  }
  const opening=project.openingSequence;
  if (opening && (!['converge','sideSlide','light3D'].includes(opening.preset) || !['smooth','swift','gentle'].includes(opening.motionCurve)
    || !validRange(opening.duration,0.4,8) || !validRange(opening.stagger,0,1.2)
    || !Array.isArray(opening.includedElements) || !Array.isArray(opening.elementOrder)
    || [...opening.includedElements,...opening.elementOrder].some((e)=>!['screen','camera','stickers'].includes(e)))) throw new Error('开场序列参数无效。');
  for(const kind of ['sticker','mosaic']){
    const items=project.timeline?.[`${kind}Clips`]||[],ids=new Set();
    for(const c of items){
      if(!c || typeof c.id!=='string' || ids.has(c.id) || !c.timing || !validRange(c.timing.startTime,0,screen.duration)
        || !validRange(c.timing.duration,0.01,screen.duration) || c.timing.startTime+c.timing.duration>screen.duration+1e-6)throw new Error('区域/贴图时间参数无效。');ids.add(c.id);
      if(kind==='sticker'){
        const animations=['none','fade','pop','slideLeft','slideRight','slideUp','slideDown','slideTopLeft','slideTopRight','slideBottomLeft','slideBottomRight'];
        if(typeof c.relativePath!=='string'||!c.relativePath||/^(?:[a-zA-Z]:|[\\/])/.test(c.relativePath)||c.relativePath.split(/[\\/]/).includes('..')
          ||!c.position||!validRange(c.position.x,0,1)||!validRange(c.position.y,0,1)||!validRange(c.width,0.02,2)||!validRange(c.opacity,0,1)||!validRange(c.rotationDegrees,-360,360)
          ||!animations.includes(c.animation)||(c.exitAnimation!=null&&!animations.includes(c.exitAnimation))||!['smooth','swift','gentle'].includes(c.animationCurve)
          ||!['cornerRadius','borderWidth','shadowRadius','backdropBlur','enterDuration','exitDuration'].every(k=>validRange(c[k],0,1000))||!validRange(c.shadowOpacity,0,1)
          ||!Number.isFinite(c.shadowOffsetX)||!Number.isFinite(c.shadowOffsetY)||!Number.isInteger(c.layerIndex)||!/^#[0-9a-f]{6}$/i.test(c.borderColor))throw new Error('贴图参数或资产路径无效。');
      }else{
        const r=c.sourceRect;
        if(!r||!validRange(r.x,0,1)||!validRange(r.y,0,1)||!validRange(r.width,0.01,1)||!validRange(r.height,0.01,1)||r.x+r.width>1+1e-6||r.y+r.height>1+1e-6
          ||!['blur','spotlight'].includes(c.style)||!validRange(c.intensity,0,1)||!validRange(c.spotlightDimming,0,1)||!validRange(c.cornerRadius,0,0.5)
          ||!['none','linear','smooth'].includes(c.transitionStyle)||!validRange(c.transitionInDuration,0,10)||!validRange(c.transitionOutDuration,0,10))throw new Error('柔化/突出区域参数无效。');
      }
    }
  }
  for(const type of ['zoom','screenMotion','cameraMotion'])for(const clip of type==='zoom'?project.zoomAnimations||[]:project.timeline?.[`${type}Clips`]||[])if(clip.animationSlice)require('./effect-slices').validateSlice(project,type,clip);
}

function fixedAspectRatio(canvas) {
  if (canvas.aspectRatio === 'custom') {
    const { width, height } = canvas.customAspectRatio || { width: 16, height: 9 };
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? clamp(width / height, 0.1, 10) : 16 / 9;
  }
  const entry = ASPECT_RATIOS[canvas.aspectRatio];
  return entry ? entry.ratio : null;
}

function normalizedCrop(value = {}) {
  const safe = (number, fallback) => Number.isFinite(number) ? number : fallback;
  const x = clamp(safe(value.x, 0), 0, 0.98), y = clamp(safe(value.y, 0), 0, 0.98);
  return { x, y, width: clamp(safe(value.width, 1), 0.02, 1 - x), height: clamp(safe(value.height, 1), 0.02, 1 - y) };
}

/// 对应 CanvasStyle.pixelDimensions：导出画布像素尺寸。
function canvasDimensions(canvas, resolution, source) {
  const original = source || { width: 1920, height: 1080 };
  const crop = normalizedCrop(canvas.crop);
  const src = { width: original.width * crop.width, height: original.height * crop.height };
  const fixed = fixedAspectRatio(canvas);
  const preset = RESOLUTIONS[resolution] || RESOLUTIONS.source;
  if (!preset.short) {
    const w = Math.max(src.width, 2);
    const h = Math.max(src.height, 2);
    if (!fixed) return { width: even(w), height: even(h) };
    // 固定比例在素材像素包络内取最大，不放大素材。
    return w / h >= fixed
      ? { width: even(h * fixed), height: even(h) }
      : { width: even(w), height: even(w / fixed) };
  }
  const { short, long } = preset;
  switch (canvas.aspectRatio) {
    case 'landscape': return { width: even(short * 16 / 9), height: short };
    case 'standard': return { width: even(short * 4 / 3), height: short };
    case 'portrait': return { width: short, height: even(short * 16 / 9) };
    case 'square': return { width: short, height: short };
    case 'standardPortrait': return { width: short, height: even(short * 4 / 3) };
    default: {
      // 适应素材比例与超宽比例都以长边为准。
      const ratio = fixed || clamp(src.width / src.height, 0.2, 5);
      return ratio >= 1
        ? { width: even(long), height: even(long / ratio) }
        : { width: even(long * ratio), height: even(long) };
    }
  }
}

/// 对应 ExportEncodingPolicy.videoBitrate。
function exportVideoBitrate(width, height, frameRate) {
  const pixels = Math.max(width * height, 1);
  const ceiling = pixels >= 7_000_000 ? 130_000_000 : pixels >= 3_500_000 ? 100_000_000 : 65_000_000;
  return Math.min(Math.max(Math.floor(pixels * Math.max(frameRate, 1) / 6), 12_000_000), ceiling);
}

const EXPORT_AUDIO_BITRATE = 192_000;

module.exports = {
  clamp, even, uid: randomUUID,
  ASPECT_RATIOS, RESOLUTIONS, PATTERN_PRESETS, CAMERA_SHAPES, CLICK_EFFECTS, ZOOM_EASINGS,
  defaultCanvas, defaultCamera, defaultCursorStyle, defaultMotion, defaultAudio,
  makeProject, normalizeProject, validateProjectContract, normalizedCrop, canvasDimensions, exportVideoBitrate, EXPORT_AUDIO_BITRATE,
};
