'use strict';
// 预览播放：一个以输出时间为准的主时钟，屏幕、摄像头与两条音轨的媒体元素都跟随它。
// 画面由与导出相同的 Compositor 绘制。

const path = require('node:path');
const { fileUrl } = require('../common');
const { canvasDimensions, clamp } = require('../../core/model');
const { evaluateScene } = require('../../core/scene');
const timeline = require('../../core/timeline');
const { Compositor } = require('./render');
const { seekTrack, finishSeek, PreviewFrameCache } = require('./media-preview-state');
const {segmentVolume}=require('../../core/segment-audio');
const {mediaTime}=require('../../core/media-time');

const DRIFT_TOLERANCE = 0.14;
const MAX_PREVIEW_PIXELS = 2560;

class Preview {
  constructor(store, canvas, wrap) {
    this.store = store;
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.compositor = new Compositor(store.directory);
    window.addEventListener('unload', () => this.compositor.dispose(), { once: true });
    this.screenFrame = new PreviewFrameCache();
    this.cameraFrame = new PreviewFrameCache();
    this.backgroundFrame = new PreviewFrameCache();
    this.time = 0; // 输出时间
    this.playing = false;
    this.lastTick = 0;
    this.dirty = true;
    this.onTime = () => {};
    this.onState = () => {};
    this.onError = (error) => console.error(error);
    this.onDraw=()=>{};

    const { media } = store.project;
    const make = (tag, track, muted) => {
      if (!track) return null;
      const node = document.createElement(tag);
      node.src = fileUrl(path.resolve(store.directory, track.file));
      node.preload = 'auto';
      node.muted = muted;
      const state = { node, file:track.file, offset: track.offset || 0, duration: track.duration,reference:track, pendingTime: null };
      node.addEventListener('seeked', () => { finishSeek(state); this.invalidate(); });
      node.addEventListener('loadeddata', () => this.invalidate());
      return state;
    };
    this.screen = make('video', media.screen, true);
    this.camera = make('video', media.camera, true);
    this.microphone = make('audio', media.microphone, false);
    this.system = make('audio', media.systemAudio, false);
    this.makeTrack=make;this.updateBackground();

    new ResizeObserver(() => this.layout()).observe(wrap);
    store.subscribe((reason) => {
      if (reason === 'project') {
        this.updateTracks();
        this.updateBackground();
        this.time = clamp(this.time, 0, this.duration);
        this.compositor.prepare(store.project).then(() => this.invalidate()).catch((e)=>this.onError(e));
        this.layout();
        this.syncMedia(false);
      }
      this.invalidate();
    });
    this.compositor.prepare(store.project).then(() => this.invalidate()).catch((e)=>this.onError(e));
    this.layout();
    this.syncMedia(true);
    requestAnimationFrame((now) => this.frame(now));
  }

  get segments() { return this.store.project.timeline.segments; }

  updateTracks(){
    for(const [name,key,tag]of [['screen','screen','video'],['camera','camera','video'],['microphone','microphone','audio'],['system','systemAudio','audio']]){
      const reference=this.store.project.media[key],current=this[name];if(reference?.file===current?.file)continue;
      if(current){current.node.pause();current.node.removeAttribute('src');current.node.load();}
      this[name]=reference?this.makeTrack(tag,reference,tag==='video'):null;
      if(name==='screen')this.screenFrame=new PreviewFrameCache();if(name==='camera')this.cameraFrame=new PreviewFrameCache();
    }
  }

  updateBackground(){
    const bg=this.store.project.canvas.background,file=bg.kind==='video'?bg.file:null;
    if(file===this.backgroundFile)return;
    if(this.background){this.background.node.pause();this.background.node.removeAttribute('src');this.background.node.load();}
    this.backgroundFile=file;this.background=file?this.makeTrack('video',{file,duration:bg.duration,offset:0},true):null;
    this.backgroundFrame=new PreviewFrameCache();
    if(this.background)this.background.node.loop=true;
  }

  get duration() { return timeline.outputDuration(this.segments); }

  get sourceTime() { return timeline.locate(this.segments, this.time).sourceTime; }

  invalidate() { this.dirty = true; }

  /// 预览画布按导出画布的比例铺满可用区域。
  layout() {
    const { media, canvas } = this.store.project;
    const output = canvasDimensions(canvas, 'source', media.screen);
    const bounds = this.wrap.getBoundingClientRect();
    if (bounds.width < 10 || bounds.height < 10) return;
    const scale = Math.min(bounds.width / output.width, bounds.height / output.height);
    const cssWidth = Math.floor(output.width * scale);
    const cssHeight = Math.floor(output.height * scale);
    const pixelScale = Math.min(devicePixelRatio, MAX_PREVIEW_PIXELS / Math.max(cssWidth, cssHeight));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    const width = Math.max(Math.round(cssWidth * pixelScale), 2);
    const height = Math.max(Math.round(cssHeight * pixelScale), 2);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.invalidate();
  }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration - 0.02) this.time = 0;
    this.playing = true;
    this.lastTick = performance.now();
    this.syncMedia(true);
    this.onState();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.syncMedia(true);
    this.onState();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  seek(time) {
    this.time = clamp(time, 0, this.duration);
    this.syncMedia(true);
    this.invalidate();
    this.onTime(this.time);
  }

  /// 把各媒体元素对到主时钟上。播放中只在漂移超过容差时才重新定位，避免频繁 seek 造成卡顿。
  syncMedia(force) {
    const hit = timeline.locate(this.segments, this.time);
    if (!hit) return;
    const { audio } = this.store.project;
    const volumes = {
      microphone: segmentVolume(this.store.project,hit.segment,'microphone'),
      system: segmentVolume(this.store.project,hit.segment,'system'),
    };
    for (const [name, track] of [['screen', this.screen], ['camera', this.camera], ['microphone', this.microphone], ['system', this.system],['background',this.background]]) {
      if (!track) continue;
      const { node } = track;
      const limit = (Number.isFinite(node.duration) ? node.duration : track.duration) - 0.03;
      let wanted = hit.sourceTime - track.offset;
      let sourceRate=1,mappedRange=true;
      if(['camera','microphone','system'].includes(name)){
        const reference=this.store.project.media[name==='system'?'systemAudio':name]||track.reference;
        const mapped=mediaTime(reference,hit.sourceTime);wanted=mapped.time;sourceRate=mapped.rate;mappedRange=mapped.inRange;
      }
      if(name==='background'){const duration=Number.isFinite(node.duration)?node.duration:track.duration;if(duration>0)wanted=((hit.sourceTime%duration)+duration)%duration;}
      const inRange = mappedRange && wanted >= 0 && wanted <= limit;
      track.inRange = inRange;
      if (volumes[name] !== undefined) node.volume = clamp(volumes[name], 0, 1);
      if (!inRange) {
        if (!node.paused) node.pause();
        // 屏幕画面超出范围时停在最近的一帧上。
        if (name === 'screen' && (force || node.paused)) {
          const edge = clamp(wanted, 0, Math.max(limit, 0));
          seekTrack(track, edge);
        }
        continue;
      }
      if (this.playing) {
        const speed=Math.min(Math.max(hit.segment.speed*sourceRate,0.0625),16);
        if (node.playbackRate !== speed) node.playbackRate = speed;
        if (force || node.paused || Math.abs(node.currentTime - wanted) > DRIFT_TOLERANCE * Math.max(hit.segment.speed, 1)) {
          seekTrack(track, wanted);
          if (node.paused) node.play().catch(() => {});
        }
      } else {
        if (!node.paused) node.pause();
        seekTrack(track, wanted);
      }
    }
  }

  frame(now) {
    if (this.playing) {
      const previousIndex = timeline.locate(this.segments, this.time).index;
      this.time += (now - this.lastTick) / 1000;
      this.lastTick = now;
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.pause();
      } else {
        // 跨过剪辑点时素材时间跳变，需要立即重新定位而不是等漂移超限。
        this.syncMedia(timeline.locate(this.segments, this.time).index !== previousIndex);
      }
      this.onTime(this.time);
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    requestAnimationFrame((next) => this.frame(next));
  }

  draw() {
    const { project, zoomClips, pointerTrack } = this.store;
    const { media } = project;
    const screen = this.screenFrame.frame(this.screen && this.screen.node);
    const camera = this.cameraFrame.frame(this.camera && this.camera.node);
    const cameraVisible = this.camera && this.camera.inRange && !project.camera.isHidden;
    const scene = evaluateScene(project, {
      time: this.sourceTime,
      width: this.canvas.width,
      height: this.canvas.height,
      sourceAspect: media.screen.width / media.screen.height,
      cameraAspect: cameraVisible ? media.camera.width / media.camera.height : null,
      zoomClips,
      pointerTrack,
    });
    this.scene = scene;
    // During first load there is no cached frame yet. Do not replace an already
    // displayed canvas with the compositor's dark missing-media placeholder.
    if (!screen) return;
    this.compositor.draw(this.ctx, project, scene, { screen, camera: cameraVisible ? camera : null,background:this.backgroundFrame.frame(this.background?.node) });
    this.onDraw();
  }
}

module.exports = { Preview };
