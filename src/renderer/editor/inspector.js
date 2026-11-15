'use strict';
// 右侧检查器：画面 / 运镜 / 光标 / 摄像头 / 声音。控件直接读写项目文档，拖动过程合并成一步撤销。

const path = require('node:path');
const fs = require('node:fs');
const { ipcRenderer } = require('electron');
const { element, fileUrl } = require('../common');
const { PATTERN_PRESETS, CAMERA_SHAPES, CLICK_EFFECTS, ZOOM_EASINGS, clamp, normalizedCrop } = require('../../core/model');
const { planAutoZoom } = require('../../core/zoom');
const { isInside } = require('../../core/pointer');
const { defaultFocus } = require('../../core/focus-effect');
const { normalizeOpening } = require('../../core/opening-sequence');
const {makeSticker,makeMosaic,STICKER_ANIMATIONS}=require('../../core/overlays');
const {FRAME_STYLES,decorationInsets}=require('../../core/screen-decoration');
const {compactNumber}=require('../../core/editor-selection');

const TABS = [
  { id: 'canvas', label: '画面', icon: 'canvas' },
  { id: 'motion', label: '运镜', icon: 'motion' },
  { id: 'screenMotion', label: '屏幕 3D', icon: 'motion' },
  { id: 'cursor', label: '光标', icon: 'cursor' },
  { id: 'camera', label: '摄像头', icon: 'camera' },
  { id: 'cameraMotion', label: '摄像头动画', icon: 'camera' },
  { id: 'opening', label: '开场', icon: 'motion' },
  { id: 'sticker', label: '贴图', icon: 'canvas' },
  { id: 'mosaic', label: '柔化／突出', icon: 'canvas' },
  { id: 'presets', label: '场景', icon: 'canvas' },
  { id: 'audio', label: '声音', icon: 'speaker' },
  { id: 'assets', label: '素材', icon: 'folder' },
];

class Inspector {
  constructor(store, preview, root, title) {
    this.store = store;
    this.preview = preview;
    this.root = root;
    this.title = title;
    this.tab = 'canvas';
    this.wallpapers = null;
    this.assets=[];
    this.refreshAssets=()=>ipcRenderer.invoke('project:assets',{directory:this.store.directory,project:this.store.project}).then(value=>{this.assets=value;if(this.tab==='assets')this.render();}).catch(error=>this.preview.onError(error));
    this.presets=[];this.presetName='我的场景';
    this.refreshPresets=()=>ipcRenderer.invoke('preset:list').then(value=>{this.presets=value;if(this.tab==='presets')this.render();}).catch(error=>console.warn(error.message));
    this.refreshPresets();
    store.subscribe((reason) => {
      // 拖动滑块时只更新数值显示，不重建控件，否则正在拖的滑块会被换掉。
      if (reason === 'project' && store.gesture) this.refreshValues();
      else if (reason === 'project' || reason === 'selection' || reason === 'history') this.render();
    });
    ipcRenderer.invoke('system:wallpapers').then((wallpapers) => { this.wallpapers = wallpapers; if (this.tab === 'canvas') this.render(); });
  }

  show(tab) {
    this.tab = tab;
    if(tab==='assets')this.refreshAssets();
    this.render();
  }

  // ---------------------------------------------------------------- 控件

  section(title, ...children) {
    return element('div', { class: 'section' }, title ? element('h3', {}, title) : null, children);
  }

  slider(label, get, set, { min, max, step, format = compactNumber }) {
    const value = element('span', { class: 'value' }, format(get()));
    const input = element('input', { type: 'range', min, max, step, value: get() });
    input.addEventListener('pointerdown', () => this.store.beginGesture());
    input.addEventListener('input', () => {
      this.store.beginGesture();
      this.store.mutate(() => set(Number(input.value)), { history: false });
    });
    // 只按下没拖动时不会有 change 事件，松手与失焦也要收尾。
    for (const type of ['change', 'pointerup', 'blur']) input.addEventListener(type, () => this.store.endGesture());
    this.refreshers.push(() => { value.textContent = format(get()); });
    return element('label', { class: 'field' }, element('span', {}, label), value, input);
  }

  toggle(label, get, set) {
    const button = element('button', { class: `switch${get() ? ' on' : ''}`, onclick: () => this.store.mutate(() => set(!get())) });
    return element('div', { class: 'field' }, element('span', {}, label), button);
  }

  number(label, get, set, { min = 0.1, max = 100, step = 0.1 } = {}) {
    const input = element('input', { type: 'number', min, max, step, value: get() });
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < min || value > max) { input.value = get(); return; }
      this.store.mutate(() => set(value));
    });
    return element('label', { class: 'field' }, element('span', {}, label), input);
  }

  text(label,get,set){const input=element('input',{type:'text',value:get()});input.addEventListener('change',()=>this.store.mutate(()=>set(input.value)));return element('label',{class:'field'},element('span',{},label),input);}

  select(label, options, get, set) {
    const input = element('select', {}, Object.entries(options).map(([value, text]) => element('option', { value, selected: value === String(get()) }, text)));
    input.addEventListener('change', () => this.store.mutate(() => set(input.value)));
    return element('div', { class: 'field' }, element('span', {}, label), input);
  }

  color(label, get, set) {
    const input = element('input', { type: 'color', value: get() });
    input.addEventListener('input', () => { this.store.beginGesture(); this.store.mutate(() => set(input.value.toUpperCase()), { history: false }); });
    input.addEventListener('change', () => this.store.endGesture());
    return element('div', { class: 'field' }, element('span', {}, label), input);
  }

  chips(options, get, set) {
    return element('div', { class: 'chips' }, Object.entries(options).map(([value, text]) =>
      element('button', { class: value === String(get()) ? 'active' : '', onclick: () => this.store.mutate(() => set(value)) }, text)));
  }

  button(label, onClick, kind = '') {
    return element('button', { class: `btn ${kind}`, onclick: onClick }, label);
  }

  /// 二维定位板：在 0…1 的方框里拖动一个点。
  pad(get, set, { aspect, background, viewport }) {
    const dot = element('i');
    const view = viewport ? element('div', { class: 'view' }) : null;
    const node = element('div', { class: 'pad', style: `aspect-ratio:${aspect};${background ? `background-image:url("${background}")` : ''}` }, view, dot);
    const place = () => {
      const point = get();
      dot.style.left = `${point.x * 100}%`;
      dot.style.top = `${point.y * 100}%`;
      if (view) {
        const rect = viewport();
        Object.assign(view.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
      }
    };
    const update = (event) => {
      const bounds = node.getBoundingClientRect();
      const point = { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
      this.store.mutate(() => set(point), { history: false });
    };
    node.addEventListener('pointerdown', (event) => {
      node.setPointerCapture(event.pointerId);
      this.store.beginGesture();
      update(event);
      const move = (moveEvent) => update(moveEvent);
      const up = () => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        this.store.endGesture();
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
    this.refreshers.push(place);
    place();
    return node;
  }

  refreshValues() { for (const refresh of this.refreshers) refresh(); }

  render() {
    this.refreshers = [];
    const tab = TABS.find((item) => item.id === this.tab);
    this.title.textContent = tab.label;
    const scroll = this.root.scrollTop;
    this.root.replaceChildren(...(this.store.selections.length>1?[element('p',{class:'note'},`已选中 ${this.store.selections.length} 个片段；此处参数仅修改当前片段。`)]:[]),...this[`${this.tab}Panel`]());
    this.root.scrollTop = scroll;
  }

  // ---------------------------------------------------------------- 面板

  assetsPanel(){return[this.section('工程素材',this.button('刷新素材状态',()=>this.refreshAssets()),element('p',{class:'note'},'重新定位会复制素材到工程内，保留已有剪辑。视频尺寸应一致，音视频不能比原素材短。'),
    ...this.assets.map(asset=>this.section(`${asset.label} · ${asset.exists?'可用':'缺失'}`,element('p',{class:'note',style:'word-break:break-all'},asset.file),this.button('重新定位…',async()=>{
      try{this.preview.pause();const patch=await ipcRenderer.invoke('project:relink-asset',{directory:this.store.directory,project:this.store.project,key:asset.key});if(!patch)return;this.store.mutate(project=>require('../../core/project-assets').replaceAsset(project,this.store.directory,patch.original,patch.replacement,patch.index));await this.refreshAssets();}
      catch(error){this.preview.onError(error);}
    }))))];}

  canvasPanel() {
    const { project } = this.store;
    const canvas = project.canvas;
    const background = canvas.background;
    const setBackground = (value) => this.store.mutate((draft) => { draft.canvas.background = value; });
    const patterns = Object.entries(PATTERN_PRESETS).map(([id, preset]) => element('button', {
      class: background.kind === 'pattern' && background.preset === id ? 'active' : '', title: preset.label,
      style: `background:${preset.background};background-image:${preset.kind === 'dots'
        ? `radial-gradient(${preset.dot} 1px, transparent 1.4px)` : `linear-gradient(${preset.stroke} 1px, transparent 1px), linear-gradient(90deg, ${preset.stroke} 1px, transparent 1px)`};background-size:9px 9px`,
      onclick: () => setBackground({ kind: 'pattern', preset: id }),
    }));
    const files = this.wallpapers ? [this.wallpapers.current, ...this.wallpapers.files].filter(Boolean) : [];
    const wallpapers = files.slice(0, 8).map((file, index) => element('button', {
      class: background.kind === 'image' && background.file === file ? 'active' : '', title: index === 0 && this.wallpapers.current ? '当前桌面壁纸' : path.basename(file),
      style: `background-image:url("${fileUrl(file)}")`, onclick: () => setBackground({ kind: 'image', file }),
    }));
    const pickImage = async () => {
      const file = await ipcRenderer.invoke('dialog:open-image');
      if (!file) return;
      // 自选图片复制进项目包，移动或拷贝项目时背景不会丢。
      const name = `background${path.extname(file).toLowerCase()}`;
      fs.copyFileSync(file, path.join(this.store.directory, 'media', name));
      this.preview.compositor.images.delete(path.join(this.store.directory, 'media', name));
      setBackground({ kind: 'image', file: `media/${name}`, stamp: Date.now() });
    };
    return [
      this.section('背景',
        element('div', { class: 'swatches' }, patterns),
        files.length ? element('p', { class: 'note' }, 'Windows 壁纸') : null,
        files.length ? element('div', { class: 'swatches' }, wallpapers) : null,
        element('div', { class: 'row' },
          this.button('选择图片…', pickImage),
          this.button('纯色', () => setBackground({ kind: 'color', color: background.color || '#1F2A44' }))),
        background.kind === 'color' ? this.color('颜色', () => background.color, (value) => { canvas.background = { kind: 'color', color: value }; }) : null,
        background.kind === 'image' ? this.slider('背景模糊', () => canvas.backgroundBlur, (value) => { canvas.backgroundBlur = value; }, { min: 0, max: 60, step: 1 }) : null,
        background.kind === 'pattern' ? this.slider('图案大小', () => canvas.patternScale, (value) => { canvas.patternScale = value; }, { min: 0.4, max: 4, step: 0.05, format: (value) => `${value.toFixed(2)}×` }) : null),
      this.section('画面留白',
        this.slider('边距', () => canvas.padding, (value) => { canvas.padding = value; }, { min: 0, max: 320, step: 2 })),
      this.section('动态背景',this.select('动态图案',{cyberDriftGrid:'流金缓移网格',starfieldDots:'暖星漫步点阵',auroraFluid:'蓝白流体云幕'},()=>canvas.background.kind==='dynamic'?canvas.background.preset:'cyberDriftGrid',v=>{canvas.background={kind:'dynamic',preset:v};}),
        this.button('启用动态背景',()=>setBackground({kind:'dynamic',preset:'cyberDriftGrid'})),
        this.button('视频背景…',async()=>{try{const value=await ipcRenderer.invoke('project:import-background-video',this.store.directory);if(value)setBackground(value);}catch(error){this.preview.onError(error);}})),
      this.section('装饰框',this.select('外框样式',FRAME_STYLES,()=>canvas.screenFrame,v=>{canvas.screenFrame=v;}),
        ...(canvas.screenFrame!=='none'?[
        this.slider('外框比例',()=>canvas.screenFrameScale,v=>{canvas.screenFrameScale=v;},{min:0.5,max:2,step:0.05}),
        this.slider('工具栏比例',()=>canvas.screenFrameToolbarScale,v=>{canvas.screenFrameToolbarScale=v;},{min:0.5,max:2,step:0.05}),
        this.slider('外框圆角',()=>canvas.screenFrameOuterCornerRadius??canvas.cornerRadius+decorationInsets(canvas).left,v=>{canvas.screenFrameOuterCornerRadius=v;},{min:0,max:200,step:1}),
        this.slider('内容圆角',()=>canvas.screenFrameContentCornerRadius??canvas.cornerRadius,v=>{canvas.screenFrameContentCornerRadius=v;},{min:0,max:200,step:1}),
        this.slider('外框透明度',()=>canvas.screenFrameInsetOpacity,v=>{canvas.screenFrameInsetOpacity=v;},{min:0,max:1,step:0.01,format:v=>`${Math.round(v*100)}%`}),
        this.text('窗口标题',()=>canvas.screenFrameTitle,v=>{canvas.screenFrameTitle=v;}),this.text('浏览器地址',()=>canvas.screenFrameBrowserAddress,v=>{canvas.screenFrameBrowserAddress=v;}),
        this.button('恢复外框默认参数',()=>this.store.mutate(p=>{Object.assign(p.canvas,{screenFrameOuterCornerRadius:null,screenFrameContentCornerRadius:null,screenFrameInsetOpacity:1,screenFrameScale:1,screenFrameToolbarScale:1});}))]:[])),
      ...(canvas.aspectRatio === 'custom' ? [this.section('自定义画幅',
        this.number('宽度比例', () => canvas.customAspectRatio.width, (value) => { canvas.customAspectRatio.width = value; }),
        this.number('高度比例', () => canvas.customAspectRatio.height, (value) => { canvas.customAspectRatio.height = value; }))] : []),
      this.section('素材裁切',
        ...['left', 'right', 'top', 'bottom'].map((edge, i) => {
          const get = () => { const c = normalizedCrop(canvas.crop); return { left: c.x, right: 1-c.x-c.width, top: c.y, bottom: 1-c.y-c.height }[edge]; };
          const set = (value) => {
            const c = normalizedCrop(canvas.crop), edges = { left: c.x, right: 1-c.x-c.width, top: c.y, bottom: 1-c.y-c.height };
            const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[edge];
            edges[edge] = clamp(value, 0, 0.98-edges[opposite]);
            canvas.crop = { x: edges.left, y: edges.top, width: 1-edges.left-edges.right, height: 1-edges.top-edges.bottom };
          };
          return this.slider(['左侧', '右侧', '顶部', '底部'][i], get, set, { min: 0, max: 0.98, step: 0.01, format: (value) => `${Math.round(value*100)}%` });
        }),
        this.button('恢复完整素材', () => this.store.mutate(() => { canvas.crop = { x: 0, y: 0, width: 1, height: 1 }; }))),
      this.section('位置与大小',
        this.pad(() => canvas.contentPosition, (point) => { canvas.contentPosition = point; }, { aspect: '16 / 9' }),
        this.slider('素材缩放', () => canvas.contentScale, (value) => { canvas.contentScale = value; }, { min: 0.5, max: 2, step: 0.01, format: (value) => `${value.toFixed(2)}×` }),
        element('div', { class: 'row' }, this.button('恢复位置与大小', () => this.store.mutate((draft) => { draft.canvas.contentPosition = { x: 0.5, y: 0.5 }; draft.canvas.contentScale = 1; })))),
      this.section('圆角、描边与阴影',
        this.slider('内容圆角', () => canvas.cornerRadius, (value) => { canvas.cornerRadius = value; }, { min: 0, max: 120, step: 1 }),
        this.slider('外描边', () => canvas.borderWidth, (value) => { canvas.borderWidth = value; }, { min: 0, max: 30, step: 0.5 }),
        canvas.borderWidth > 0 ? this.color('描边颜色', () => canvas.borderColor, (value) => { canvas.borderColor = value; }) : null,
        this.slider('阴影', () => canvas.shadowStrength, (value) => { canvas.shadowStrength = value; }, { min: 0, max: 1, step: 0.01, format: (value) => `${Math.round(value * 100)}%` })),
    ];
  }

  slicePanel(type,clip){
    return this.section('保留原动画进度',element('p',{class:'note'},'此片段保留拆分前的曲线与过渡，可移动、复制、删除或按 S 继续拆分。解除后按独立片段重新计算动画。'),
      this.button('解除进度保留并独立编辑',()=>this.store.releaseAnimationSlice(type,clip.id)),
      this.button('删除选中效果',()=>this.store.deleteSelections(),'danger'));
  }

  motionPanel() {
    const { project, pointerTrack } = this.store;
    const motion = project.motion;
    const clip = this.store.selectedZoom;
    if(clip?.animationSlice)return [this.slicePanel('zoom',clip)];
    const clicks = pointerTrack ? pointerTrack.clicks.filter(isInside).length : 0;
    const regenerate = () => this.store.mutate((draft) => {
      const manual = draft.zoomAnimations.filter((item) => item.origin === 'manual');
      const automatic = planAutoZoom(pointerTrack.events.filter(isInside), {
        zoomScale: draft.motion.defaultZoomScale, easing: draft.motion.defaultZoomEasing,
        transitionDuration: draft.motion.defaultZoomTransitionDuration, duration: draft.media.screen.duration,
      // 手动缩放优先：与手动片段重叠的自动片段不生成。
      }).filter((item) => !manual.some((other) => item.startTime < other.endTime + other.exitDuration && other.startTime < item.endTime + item.exitDuration));
      draft.zoomAnimations = [...manual, ...automatic];
    });
    const sections = [];
    if (clip) {
      const source = project.media.screen;
      const thumbnails = project.media.thumbnails;
      sections.push(this.section(`选中的缩放 · ${clip.origin === 'automatic' ? '自动跟随' : '手动'}`,
        this.slider('放大倍率', () => clip.scale, (value) => { clip.scale = value; }, { min: 1.1, max: 4, step: 0.05, format: (value) => `${value.toFixed(2)}×` }),
        element('p', { class: 'note' }, clip.origin === 'automatic' ? '自动缩放的镜头会跟着指针走。在下面的画面里点一下，可以改成固定看某个位置。' : '点击或拖动下面的画面，指定镜头对准的位置。'),
        this.pad(() => clip.focus, (point) => { clip.focus = point; clip.origin = 'manual'; }, {
          aspect: `${source.width} / ${source.height}`,
          background: null,
          viewport: () => {
            const span = 1 / clip.scale;
            return { x: clamp(clip.focus.x - span / 2, 0, 1 - span), y: clamp(clip.focus.y - span / 2, 0, 1 - span), width: span, height: span };
          },
        }),
        this.select('缓动', ZOOM_EASINGS, () => clip.easing, (value) => { clip.easing = value; }),
        this.slider('进入时长', () => clip.enterDuration, (value) => { clip.enterDuration = value; }, { min: 0, max: 2, step: 0.05, format: (value) => `${value.toFixed(2)} 秒` }),
        this.slider('退出时长', () => clip.exitDuration, (value) => { clip.exitDuration = value; }, { min: 0, max: 2, step: 0.05, format: (value) => `${value.toFixed(2)} 秒` }),
        element('div', { class: 'row' },
          clip.origin === 'manual' && pointerTrack ? this.button('改回自动跟随', () => this.store.mutate(() => { clip.origin = 'automatic'; })) : null,
          this.button('删除这段缩放', () => { this.store.mutate((draft) => { draft.zoomAnimations = draft.zoomAnimations.filter((item) => item.id !== clip.id); }); this.store.select(null); }, 'danger'))));
      // 定位板背景：取该缩放起点附近的缩略图，方便对着画面选位置。
      if (thumbnails) {
        const index = clamp(Math.floor(clip.startTime / thumbnails.interval), 0, thumbnails.count - 1);
        const pad = sections[0].querySelector('.pad');
        pad.style.backgroundImage = `url("${fileUrl(path.join(this.store.directory, thumbnails.file))}")`;
        pad.style.backgroundSize = `${thumbnails.count * 100}% 100%`;
        pad.style.backgroundPosition = `${thumbnails.count > 1 ? (index / (thumbnails.count - 1)) * 100 : 0}% 0`;
      }
      sections.push(this.focusSection(clip,false));
      if(clip.easing==='custom')sections.push(this.curveSection(clip));
    } else {
      sections.push(this.section('缩放', element('p', { class: 'note' }, '在时间线的「缩放」轨上点选一段可以单独调整；双击空白处或按 Z 在播放头位置添加一段手动缩放。')));
    }
    sections.push(this.section('自动缩放',
      element('p', { class: 'note' }, pointerTrack
        ? `这次录制记录到 ${clicks} 次点击。自动缩放会在点击处放大，并在连续操作时保持、跟随指针。`
        : '这个项目没有指针记录，无法自动生成缩放，可以手动添加。'),
      this.slider('默认放大倍率', () => motion.defaultZoomScale, (value) => { motion.defaultZoomScale = value; }, { min: 1.1, max: 3, step: 0.05, format: (value) => `${value.toFixed(2)}×` }),
      this.slider('过渡时长', () => motion.defaultZoomTransitionDuration, (value) => { motion.defaultZoomTransitionDuration = value; }, { min: 0.1, max: 2, step: 0.05, format: (value) => `${value.toFixed(2)} 秒` }),
      this.select('缓动', ZOOM_EASINGS, () => motion.defaultZoomEasing, (value) => { motion.defaultZoomEasing = value; }),
      element('div', { class: 'row' },
        pointerTrack && clicks ? this.button('按点击重新生成', regenerate) : null,
        project.zoomAnimations.length ? this.button('清除全部缩放', () => { this.store.mutate((draft) => { draft.zoomAnimations = []; }); this.store.select(null); }, 'danger') : null)));
    return sections;
  }

  screenMotionPanel() {
    const { project } = this.store;
    const clips = [...project.timeline.screenMotionClips].sort((a, b) => a.timing.startTime - b.timing.startTime);
    const clip = this.store.selectedScreenMotion;
    const sections = [this.section('屏幕 3D',
      this.button('在播放头添加 3D 片段', () => this.addScreenMotion()),
      ...clips.map((item) => this.button(`${item.timing.startTime.toFixed(2)} 秒 · ${item.timing.duration.toFixed(2)} 秒`, () => {
        this.store.select({ type: 'screenMotion', id: item.id });
        const timeline = require('../../core/timeline');
        this.preview.seek(timeline.sourceToOutput(project.timeline.segments, item.timing.startTime + item.timing.leadInDuration));
      })))];
    if (!clip) return [...sections, this.section('', element('p', { class: 'note' }, '选择时间线上的屏幕 3D 片段，调整旋转、透视和焦点。'))];
    if(clip.animationSlice)return [...sections,this.slicePanel('screenMotion',clip)];
    const t = clip.timing, target = clip.target;
    const next = clips[clips.findIndex((item) => item.id === clip.id) + 1];
    const returnLimit = Math.max(0, Math.min(10, (next ? next.timing.startTime : project.media.screen.duration) - t.startTime - t.duration));
    sections.push(this.section('空间变换',
      ...['X', 'Y', 'Z'].map((axis) => this.slider(`${axis} 轴旋转`, () => target[`rotation${axis}`], (value) => { target[`rotation${axis}`] = value; },
        { min: -80, max: 80, step: 1, format: (value) => `${value}°` })),
      this.slider('透视', () => target.perspective, (value) => { target.perspective = value; }, { min: 0, max: 2, step: 0.05 }),
      this.slider('目标缩放', () => target.scale, (value) => { target.scale = value; }, { min: 0.2, max: 4, step: 0.05, format:value=>`${value.toFixed(2)}×` }),
      this.pad(() => target.position, (value) => { target.position = value; }, { aspect: '16 / 9' })));
    sections.push(this.section('过渡',
      this.select('缓动', ZOOM_EASINGS, () => t.easing, (value) => { t.easing = value; }),
      this.slider('进入时长', () => t.leadInDuration, (value) => { t.leadInDuration = value; }, { min: 0, max: t.duration, step: 0.01 }),
      this.slider('退出时长', () => t.returnDuration, (value) => { t.returnDuration = value; }, { min: 0, max: returnLimit, step: 0.01 }),
      this.button('删除这段 3D', () => {
        this.store.deleteEffect('screenMotion',clip.id);
      }, 'danger')));
    sections.push(this.focusSection(clip,true));
    if(t.easing==='custom')sections.push(this.curveSection(t));
    return sections;
  }

  curveSection(t){
    return this.section('自定义曲线',...['x1','y1','x2','y2'].map(key=>this.slider(key,()=>t.customCurve?.[key]??({x1:0.65,y1:0,x2:0.35,y2:1}[key]),v=>{t.customCurve={x1:0.65,y1:0,x2:0.35,y2:1,...t.customCurve,[key]:v};},{min:0,max:1,step:0.01})));
  }

  focusSection(clip,linear) {
    const effect=clip.focusEffect;
    return this.section('聚焦模糊',
      this.toggle('启用聚焦',()=>Boolean(clip.focusEffect),(on)=>{clip.focusEffect=on ? defaultFocus(linear) : null;}),
      ...(effect ? [
        this.select('焦区形状',{radial:'径向',linear:'线性'},()=>effect.shape || (linear ? 'linear':'radial'),(v)=>{effect.shape=v;}),
        this.select('焦点目标',{animation:'跟随运镜',pointer:'跟随光标',fixed:'固定位置'},()=>effect.target,(v)=>{effect.target=v;}),
        ...(effect.target==='fixed' ? [this.pad(()=>effect.center,(p)=>{effect.center=p;},{aspect:'16 / 9'})] : []),
        this.slider('清晰范围',()=>effect.size,(v)=>{effect.size=v;},{min:0.1,max:1,step:0.01}),
        this.slider('模糊强度',()=>effect.blur,(v)=>{effect.blur=v;},{min:0,max:1,step:0.01}),
        this.slider('边缘羽化',()=>effect.softness,(v)=>{effect.softness=v;},{min:0,max:1,step:0.01}),
        this.slider('外部暗化',()=>effect.dimming,(v)=>{effect.dimming=v;},{min:0,max:1,step:0.01}),
        ...(effect.shape==='linear' ? [this.slider('焦区角度',()=>effect.angleDegrees || 0,(v)=>{effect.angleDegrees=v;},{min:0,max:360,step:1})] : []),
      ] : []));
  }

  cameraMotionPanel() {
    const {project}=this.store;
    if (!project.media.camera) return [this.section('摄像头动画',element('p',{class:'note'},'此工程没有摄像头素材。'))];
    const clips=[...project.timeline.cameraMotionClips].sort((a,b)=>a.timing.startTime-b.timing.startTime);
    const clip=this.store.selection?.type==='cameraMotion' ? clips.find((c)=>c.id===this.store.selection.id) : null;
    const sections=[this.section('摄像头动画',this.button('在播放头添加摄像头动画',()=>this.addCameraMotion()),this.button('添加屏幕与摄像头组合',()=>this.addPairedLayout()),
      ...clips.map((c)=>this.button(`${c.timing.startTime.toFixed(2)} 秒 · 摄像头`,()=>{
        this.store.select({type:'cameraMotion',id:c.id});
        this.preview.seek(require('../../core/timeline').sourceToOutput(project.timeline.segments,c.timing.startTime+c.timing.leadInDuration));
      })))];
    if (!clip) return sections;
    if(clip.animationSlice)return [...sections,this.slicePanel('cameraMotion',clip)];
    const s=clip.target,t=clip.timing,next=clips[clips.indexOf(clip)+1];
    sections.push(this.section('目标布局',
      this.select('布局',{...Object.fromEntries(Object.entries(CAMERA_SHAPES).map(([k,v])=>[k,v.label])),fullscreen:'全屏'},
        ()=>s.layout.kind==='fullscreen'?'fullscreen':s.layout.shape,(v)=>{s.layout=v==='fullscreen'?{kind:'fullscreen'}:{kind:'shape',shape:v};}),
      this.pad(()=>s.position,(p)=>{s.position=p;},{aspect:'16 / 9'}),
      this.slider('目标大小',()=>s.size,(v)=>{s.size=v;},{min:0.1,max:1.2,step:0.01}),
      this.slider('目标圆角',()=>s.roundness,(v)=>{s.roundness=v;},{min:0,max:1,step:0.01}),
      this.slider('目标透明度',()=>s.opacity,(v)=>{s.opacity=v;},{min:0,max:1,step:0.01})));
    sections.push(this.section('过渡',
      this.select('缓动',ZOOM_EASINGS,()=>t.easing,(v)=>{t.easing=v;}),
      this.slider('进入时长',()=>t.leadInDuration,(v)=>{t.leadInDuration=v;},{min:0,max:t.duration,step:0.01}),
      this.slider('退出时长',()=>t.returnDuration,(v)=>{t.returnDuration=v;},
        {min:0,max:Math.max(0,Math.min(10,(next?next.timing.startTime:project.media.screen.duration)-t.startTime-t.duration)),step:0.01}),
      this.button('删除摄像头动画',()=>{this.store.deleteEffect('cameraMotion',clip.id);},'danger')));
    if(t.easing==='custom')sections.push(this.curveSection(t));
    return sections;
  }

  openingPanel() {
    const s=this.store.project.openingSequence;
    const update=(change)=>{change(s);Object.assign(s,normalizeOpening(s));};
    return [this.section('开场序列',
      this.toggle('启用开场',()=>s.isEnabled,(v)=>{s.isEnabled=v;}),
      this.select('预设',{converge:'聚拢',sideSlide:'侧滑',light3D:'轻 3D'},()=>s.preset,(v)=>{s.preset=v;}),
      this.select('运动曲线',{smooth:'平滑',swift:'利落',gentle:'柔和'},()=>s.motionCurve,(v)=>{s.motionCurve=v;}),
      this.slider('总时长',()=>s.duration,(v)=>update((s)=>{s.duration=v;}),{min:0.4,max:8,step:0.05}),
      this.slider('元素间隔',()=>s.stagger,(v)=>update((s)=>{s.stagger=v;}),{min:0,max:1.2,step:0.01}),
      ...[['screen','屏幕'],['camera','摄像头'],['stickers','贴图']].map(([key,label])=>this.toggle(`${label}入场`,()=>s.includedElements.includes(key),
        (on)=>update((s)=>{s.includedElements=on?[...s.includedElements,key]:s.includedElements.filter((v)=>v!==key);}))),
      this.select('入场顺序',{screen:'屏幕优先',camera:'摄像头优先'},()=>s.elementOrder[0],(v)=>{s.elementOrder=v==='screen'?['screen','camera','stickers']:['camera','screen','stickers'];}),
      this.button('从头预览',()=>{this.preview.seek(0);this.preview.play();}))];
  }

  overlayTiming(clip){
    const limit=this.store.project.media.screen.duration;
    return this.section('时间',
      this.number('开始秒数',()=>clip.timing.startTime,(v)=>{const end=clip.timing.startTime+clip.timing.duration;clip.timing.startTime=Math.min(v,limit-0.01);clip.timing.duration=Math.max(0.01,Math.min(end-clip.timing.startTime,limit-clip.timing.startTime));},{min:0,max:Math.max(0,limit-0.01),step:0.01}),
      this.number('持续秒数',()=>clip.timing.duration,(v)=>{clip.timing.duration=Math.min(v,limit-clip.timing.startTime);},{min:0.01,max:limit,step:0.01}));
  }

  stickerPanel(){
    const {project}=this.store,clips=project.timeline.stickerClips;
    const selected=this.store.selection?.type==='sticker'?clips.find(c=>c.id===this.store.selection.id):null;
    const sections=[this.section('贴图',this.button('导入贴图…',async()=>{
      try{const file=await ipcRenderer.invoke('project:import-sticker',this.store.directory);if(!file)return;
        const start=Math.min(this.preview.sourceTime,Math.max(0,project.media.screen.duration-0.1)),clip=makeSticker(file,start,Math.min(3,project.media.screen.duration-start),clips.length);
        this.store.mutate(p=>{p.timeline.stickerClips.push(clip);});this.store.select({type:'sticker',id:clip.id});
      }catch(error){this.preview.onError(error);}
    }),...clips.map(c=>this.button(`${c.timing.startTime.toFixed(2)} 秒 · 贴图 ${c.layerIndex}`,()=>{this.store.select({type:'sticker',id:c.id});this.preview.seek(require('../../core/timeline').sourceToOutput(project.timeline.segments,c.timing.startTime+Math.min(c.enterDuration,c.timing.duration/2)));})))];
    const c=selected;if(!c)return sections;
    sections.push(this.overlayTiming(c),this.section('构图',this.pad(()=>c.position,v=>{c.position=v;},{aspect:'16 / 9'}),
      this.slider('贴图宽度',()=>c.width,v=>{c.width=v;},{min:0.02,max:2,step:0.01}),this.slider('贴图旋转',()=>c.rotationDegrees,v=>{c.rotationDegrees=v;},{min:-180,max:180,step:1}),
      this.slider('贴图透明度',()=>c.opacity,v=>{c.opacity=v;},{min:0,max:1,step:0.01}),this.slider('贴图层级',()=>c.layerIndex,v=>{c.layerIndex=v;},{min:0,max:Math.max(10,clips.length),step:1})),
    this.section('外观',this.slider('贴图圆角',()=>c.cornerRadius,v=>{c.cornerRadius=v;},{min:0,max:120,step:1}),this.slider('贴图描边',()=>c.borderWidth,v=>{c.borderWidth=v;},{min:0,max:30,step:0.5}),this.color('描边颜色',()=>c.borderColor,v=>{c.borderColor=v;}),
      this.slider('贴图阴影',()=>c.shadowOpacity,v=>{c.shadowOpacity=v;},{min:0,max:1,step:0.01}),this.slider('阴影模糊',()=>c.shadowRadius,v=>{c.shadowRadius=v;},{min:0,max:100,step:1})),
    this.section('入出动画',this.select('进入动画',STICKER_ANIMATIONS,()=>c.animation,v=>{c.animation=v;}),this.select('退出动画',{automatic:'自动反向',...STICKER_ANIMATIONS},()=>c.exitAnimation||'automatic',v=>{c.exitAnimation=v==='automatic'?null:v;}),
      this.select('动画曲线',{smooth:'平滑',swift:'利落',gentle:'柔和'},()=>c.animationCurve,v=>{c.animationCurve=v;}),this.slider('进入秒数',()=>c.enterDuration,v=>{c.enterDuration=v;},{min:0,max:3,step:0.01}),this.slider('退出秒数',()=>c.exitDuration,v=>{c.exitDuration=v;},{min:0,max:3,step:0.01})),
    this.section('背景处理',this.slider('背后模糊',()=>c.backdropBlur,v=>{c.backdropBlur=v;},{min:0,max:80,step:1}),this.toggle('同时模糊摄像头',()=>c.backdropBlurIncludesCamera,v=>{c.backdropBlurIncludesCamera=v;}),this.toggle('隐藏屏幕',()=>c.hidesScreen,v=>{c.hidesScreen=v;}),this.toggle('隐藏摄像头',()=>c.hidesCamera,v=>{c.hidesCamera=v;})),
    this.section('',this.button('删除贴图',()=>{this.store.mutate(p=>{p.timeline.stickerClips=p.timeline.stickerClips.filter(v=>v.id!==c.id);});this.store.select(null);},'danger')));
    return sections;
  }

  presetsPanel(){return[this.section('场景预设',this.text('预设名称',()=>this.presetName,v=>{this.presetName=v;}),
    this.button('保存当前场景',async()=>{try{await ipcRenderer.invoke('preset:save',{name:this.presetName,project:this.store.project,directory:this.store.directory});await this.refreshPresets();}catch(error){this.preview.onError(error);}}),
    ...this.presets.map(p=>element('div',{class:'row'},this.button(`应用 · ${p.name}`,async()=>{try{const style=await ipcRenderer.invoke('preset:apply',{id:p.id,directory:this.store.directory});this.store.mutate(project=>Object.assign(project,style));}catch(error){this.preview.onError(error);}}),
        p.builtin?null:this.button('删除预设',async()=>{try{await ipcRenderer.invoke('preset:remove',p.id);await this.refreshPresets();}catch(error){this.preview.onError(error);}},'danger'))))];}

  mosaicPanel(){
    const {project}=this.store,clips=project.timeline.mosaicClips;
    const add=(style)=>{const start=Math.min(this.preview.sourceTime,Math.max(0,project.media.screen.duration-0.1)),c=makeMosaic(start,Math.min(3,project.media.screen.duration-start),style);this.store.mutate(p=>{p.timeline.mosaicClips.push(c);});this.store.select({type:'mosaic',id:c.id});};
    const sections=[this.section('区域效果',this.button('添加柔化区域',()=>add('blur')),this.button('添加突出区域',()=>add('spotlight')),
      ...clips.map(c=>this.button(`${c.timing.startTime.toFixed(2)} 秒 · ${c.style==='blur'?'柔化':'突出'}`,()=>{this.store.select({type:'mosaic',id:c.id});this.preview.seek(require('../../core/timeline').sourceToOutput(project.timeline.segments,c.timing.startTime+Math.min(c.transitionInDuration,c.timing.duration/2)));})))];
    const c=this.store.selection?.type==='mosaic'?clips.find(v=>v.id===this.store.selection.id):null;if(!c)return sections;
    sections.push(this.overlayTiming(c),this.section('区域',this.select('效果',{blur:'柔化',spotlight:'突出'},()=>c.style,v=>{c.style=v;}),
      this.pad(()=>({x:c.sourceRect.x/Math.max(1-c.sourceRect.width,0.01),y:c.sourceRect.y/Math.max(1-c.sourceRect.height,0.01)}),v=>{c.sourceRect.x=v.x*(1-c.sourceRect.width);c.sourceRect.y=v.y*(1-c.sourceRect.height);},{aspect:'16 / 9'}),
      this.slider('区域宽度',()=>c.sourceRect.width,v=>{c.sourceRect.width=v;c.sourceRect.x=Math.min(c.sourceRect.x,1-v);},{min:0.01,max:1,step:0.01}),
      this.slider('区域高度',()=>c.sourceRect.height,v=>{c.sourceRect.height=v;c.sourceRect.y=Math.min(c.sourceRect.y,1-v);},{min:0.01,max:1,step:0.01}),
      this.slider('区域圆角',()=>c.cornerRadius,v=>{c.cornerRadius=v;},{min:0,max:0.5,step:0.01}),this.slider('效果强度',()=>c.intensity,v=>{c.intensity=v;},{min:0,max:1,step:0.01}),
      ...(c.style==='spotlight'?[this.slider('突出暗化',()=>c.spotlightDimming,v=>{c.spotlightDimming=v;},{min:0,max:1,step:0.01})]:[])),
    this.section('过渡',this.select('区域过渡',{none:'立即生效',linear:'线性',smooth:'平滑'},()=>c.transitionStyle,v=>{c.transitionStyle=v;}),this.slider('区域进入',()=>c.transitionInDuration,v=>{c.transitionInDuration=v;},{min:0,max:3,step:0.01}),this.slider('区域退出',()=>c.transitionOutDuration,v=>{c.transitionOutDuration=v;},{min:0,max:3,step:0.01}),
      this.button('删除区域效果',()=>{this.store.mutate(p=>{p.timeline.mosaicClips=p.timeline.mosaicClips.filter(v=>v.id!==c.id);});this.store.select(null);},'danger')));
    return sections;
  }

  cursorPanel() {
    const { project, pointerTrack } = this.store;
    const style = project.cursorStyle;
    if (!pointerTrack) return [this.section('光标', element('p', { class: 'note' }, '这个项目没有指针记录。'))];
    return [
      this.section('样式',
        this.select('光标', { automatic: '跟随录制', arrow: '箭头', pointingHand: '指向手型', openHand:'张开手型',closedHand:'握拳',crosshair:'十字',ibeam:'文本',notAllowed:'禁止',touchDot:'触控圆点', hidden: '隐藏' }, () => style.appearance, (value) => { style.appearance = value; }),
        this.slider('大小', () => style.size, (value) => { style.size = value; }, { min: 0.5, max: 4, step: 0.05, format: (value) => `${value.toFixed(2)}×` }),
        this.toggle('移动平滑', () => project.motion.cursor === 'smooth', (on) => { project.motion.cursor = on ? 'smooth' : 'none'; }),
        this.slider('移动倾斜',()=>style.motionTiltStrength,v=>{style.motionTiltStrength=v;},{min:2,max:4,step:0.1}),
        this.toggle('静止后隐藏', () => style.hideWhenIdle, (on) => { style.hideWhenIdle = on; }),
        style.hideWhenIdle ? this.slider('静止多久后隐藏', () => style.idleDelay, (value) => { style.idleDelay = value; }, { min: 0.2, max: 5, step: 0.1, format: (value) => `${value.toFixed(1)} 秒` }) : null),
      this.section('点击反馈',
        this.select('效果', Object.fromEntries(Object.entries(CLICK_EFFECTS).map(([id, effect]) => [id, effect.label])), () => style.clickEffectStyle, (value) => { style.clickEffectStyle = value; }),
        style.clickEffectStyle !== 'none' ? this.color('颜色', () => style.clickColor || '#FFFFFF', (value) => { style.clickColor = value; }) : null,
        style.clickEffectStyle !== 'none' ? this.slider('不透明度', () => style.clickOpacity, (value) => { style.clickOpacity = value; }, { min: 0.05, max: 1, step: 0.01, format: (value) => `${Math.round(value * 100)}%` }) : null,
        style.clickEffectStyle !== 'none' ? this.slider('大小', () => style.clickScale, (value) => { style.clickScale = value; }, { min: 0.4, max: 3, step: 0.05, format: (value) => `${value.toFixed(2)}×` }) : null),
      this.section('时间校准',
        element('p', { class: 'note' }, '光标比画面早或晚时在这里微调，不影响移动平滑。正值让光标更早出现。'),
        this.slider('光标时间', () => style.timeOffset, (value) => { style.timeOffset = value; }, { min: -0.5, max: 0.5, step: 0.005, format: (value) => `${value > 0 ? '+' : ''}${Math.round(value * 1000)} 毫秒` })),
    ];
  }

  cameraPanel() {
    const { project } = this.store;
    const camera = project.camera;
    if (!project.media.camera) return [this.section('摄像头', element('p', { class: 'note' }, '这次录制没有开摄像头。在录制条上打开摄像头后再录，摄像头画面会作为单独一轨进入项目。'))];
    return [this.mediaSyncSection('camera','摄像头同步'),
      this.section('显示',
        this.toggle('显示摄像头', () => !camera.isHidden, (on) => { camera.isHidden = !on; }),
        this.toggle('镜像', () => camera.isMirrored, (on) => { camera.isMirrored = on; })),
      this.section('形状与大小',
        this.chips(Object.fromEntries(Object.entries(CAMERA_SHAPES).map(([id, shape]) => [id, shape.label])), () => camera.shape, (value) => { camera.shape = value; }),
        this.slider('大小', () => camera.size, (value) => { camera.size = value; }, { min: 0.1, max: 1, step: 0.01, format: (value) => `${Math.round(value * 100)}%` }),
        camera.shape !== 'circle' ? this.slider('圆角', () => camera.roundness, (value) => { camera.roundness = value; }, { min: 0, max: 1, step: 0.01, format: (value) => `${Math.round(value * 100)}%` }) : null,
        this.slider('屏幕放大时', () => camera.scaleDuringZoom, (value) => { camera.scaleDuringZoom = value; }, { min: 0.3, max: 1, step: 0.01, format: (value) => `缩到 ${Math.round(value * 100)}%` })),
      this.section('位置',
        this.pad(() => camera.position, (point) => { camera.position = point; }, { aspect: '16 / 9' }),
        this.chips({ 'tl': '左上', 'tr': '右上', 'bl': '左下', 'br': '右下' }, () => '', (value) => {
          camera.position = { x: value[1] === 'l' ? 0.04 : 0.96, y: value[0] === 't' ? 0.06 : 0.94 };
        })),
      this.section('摄像头内部画面',
        this.pad(() => camera.contentPosition, (point) => { camera.contentPosition = point; }, { aspect: '16 / 9' }),
        this.slider('内部缩放', () => camera.contentScale, (value) => { camera.contentScale = value; }, { min: 1, max: 4, step: 0.05 }),
        this.button('恢复内部构图', () => this.store.mutate(() => { camera.contentScale = 1; camera.contentPosition = { x: 0.5, y: 0.5 }; }))),
      this.section('描边与阴影',
        this.slider('描边', () => camera.borderWidth, (value) => { camera.borderWidth = value; }, { min: 0, max: 18, step: 0.5 }),
        this.slider('阴影', () => camera.shadowStrength, (value) => { camera.shadowStrength = value; }, { min: 0, max: 1, step: 0.01, format: (value) => `${Math.round(value * 100)}%` })),
    ];
  }

  audioPanel() {
    const { project } = this.store;
    const audio = project.audio;
    const percent = (value) => `${Math.round(value * 100)}%`;
    const track = (title, present, mutedKey, volumeKey, missing) => this.section(title, ...(present ? [
      this.toggle('静音', () => audio[mutedKey], (on) => { audio[mutedKey] = on; }),
      this.slider('音量', () => audio[volumeKey], (value) => { audio[volumeKey] = value; }, { min: 0, max: 1, step: 0.01, format: percent }),
    ] : [element('p', { class: 'note' }, missing)]));
    const selected=this.store.selectedSegment;
    const selectedAudio=selected?this.section('选中片段声音',
      this.toggle('单独设置此片段',()=>Boolean(selected.audio),on=>{selected.audio=on?{...audio}:undefined;}),
      ...(selected.audio?[
        this.toggle('片段麦克风静音',()=>selected.audio.isMicrophoneMuted??audio.isMicrophoneMuted,v=>{selected.audio.isMicrophoneMuted=v;}),
        this.slider('片段麦克风音量',()=>selected.audio.microphoneVolume??audio.microphoneVolume,v=>{selected.audio.microphoneVolume=v;},{min:0,max:1,step:0.01}),
        this.toggle('片段系统声静音',()=>selected.audio.isSystemMuted??audio.isSystemMuted,v=>{selected.audio.isSystemMuted=v;}),
        this.slider('片段系统声音量',()=>selected.audio.systemVolume??audio.systemVolume,v=>{selected.audio.systemVolume=v;},{min:0,max:1,step:0.01}),
      ]:[])):this.section('片段声音',element('p',{class:'note'},'在时间线上选中主片段后，可单独设置该片段的音量和静音。'));
    return [selectedAudio,
      this.section('时间线显示',this.toggle('显示音频波形',()=>project.timeline.showWaveforms!==false,v=>{project.timeline.showWaveforms=v;})),
      ...(project.media.microphone?[this.mediaSyncSection('microphone','麦克风同步')]:[]),
      ...(project.media.systemAudio?[this.mediaSyncSection('systemAudio','系统声音同步')]:[]),
      track('麦克风', project.media.microphone, 'isMicrophoneMuted', 'microphoneVolume', '这次录制没有录麦克风。'),
      track('系统声音', project.media.systemAudio, 'isSystemMuted', 'systemVolume', '这次录制没有录系统声音。'),
    ];
  }

  mediaSyncSection(kind,label){
    const ref=this.store.project.media[kind];
    const apply=change=>{const old=JSON.parse(JSON.stringify(ref));change(ref);try{require('../../core/model').validateProjectContract(this.store.project);}catch(error){for(const k of Object.keys(ref))delete ref[k];Object.assign(ref,old);this.preview.onError(error);}};
    return this.section(label,
      this.slider('轨道偏移',()=>ref.startOffset??ref.offset??0,v=>apply(r=>{if(r.startOffset!==undefined)r.startOffset=v;else r.offset=v;}),{min:-3,max:3,step:0.005}),
      this.number('源起始秒',()=>ref.sourceStartTime||0,v=>apply(r=>{r.sourceStartTime=v;}),{min:0,max:ref.duration,step:0.01}),
      this.number('源结束秒',()=>ref.sourceEndTime??ref.duration,v=>apply(r=>{r.sourceEndTime=v;}),{min:0,max:ref.duration,step:0.01}),
      this.number('时钟速率',()=>ref.sourceTimeScale??1,v=>apply(r=>{r.sourceTimeScale=v;}),{min:0.95,max:1.05,step:0.0001}),
      this.button('在播放头添加同步锚点',()=>this.store.mutate(()=>{ref.syncAnchors=ref.syncAnchors||[];if(!ref.syncAnchors.some(a=>Math.abs(a.sourceTime-this.preview.sourceTime)<0.001))ref.syncAnchors.push({id:require('node:crypto').randomUUID(),sourceTime:this.preview.sourceTime,offset:0});})),
      ...(ref.syncAnchors||[]).map(a=>this.number(`${a.sourceTime.toFixed(2)} 秒校正`,()=>a.offset,v=>apply(()=>{a.offset=v;}),{min:-10,max:10,step:0.005})),
      this.button('清除同步锚点',()=>this.store.mutate(()=>{ref.syncAnchors=[];})));
  }
}

module.exports = { Inspector, TABS };
