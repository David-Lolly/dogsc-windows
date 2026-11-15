'use strict';
// 一次录制的生命周期：开始采集 → 记录指针与标记 → 结束后整理成 .dogscproject 项目包。

const fs = require('node:fs');
const path = require('node:path');
const { screen } = require('electron');
const media = require('./ffmpeg');
const { PointerRecorder, toSourceTimeline, windowRects, bringToFront, isWindowMinimized, monitorAtPoint } = require('./pointer-recorder');
const { makeProject, uid } = require('../core/model');
const { planAutoZoom } = require('../core/zoom');
const { isInside } = require('../core/pointer');

const PROJECT_EXTENSION = '.dogscproject';

/// 菜单按主屏/位置排序；采集用 HMONITOR，菜单次序不是 DXGI 输出序号。
function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays()
    .sort((a, b) => (b.id === primaryId) - (a.id === primaryId) || a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map((display, outputIndex) => {
      const center=screen.dipToScreenPoint({x:Math.round(display.bounds.x+display.bounds.width/2),y:Math.round(display.bounds.y+display.bounds.height/2)});
      const monitor=monitorAtPoint(center);
      return ({
      id: display.id,
      outputIndex,
      label: display.label || `显示器 ${outputIndex + 1}`,
      isPrimary: display.id === primaryId,
      scaleFactor: display.scaleFactor,
      bounds: display.bounds,
      physical: monitor?.rect || screen.dipToScreenRect(null, display.bounds),
      hmonitor:monitor?.handle || null,
    });});
}

function uniqueProjectDirectory(root, name) {
  const safe = name.replace(/[\\/:*?"<>|]/g, ' ').trim() || '未命名录制';
  let candidate = path.join(root, safe + PROJECT_EXTENSION);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(root, `${safe} ${n}${PROJECT_EXTENSION}`);
  return candidate;
}

function defaultProjectName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `录屏 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

/// 把界面上的来源选择换成采集参数与"当前采集矩形"（物理像素，供指针归一化）。
function resolveSource(selection) {
  const displays = listDisplays();
  /// 显示器内的一块区域。requested 为相对该显示器左上角的物理像素矩形。
  const areaSource = (display, requested, description) => {
    // H.264 4:2:0 需要偶数宽高。
    const floorEven = (value) => Math.max(Math.floor(value / 2) * 2, 64);
    const left = Math.min(Math.max(Math.round(requested.x), 0), Math.max(display.physical.width - 64, 0));
    const top = Math.min(Math.max(Math.round(requested.y), 0), Math.max(display.physical.height - 64, 0));
    const width = floorEven(Math.min(requested.x + requested.width, display.physical.width) - left);
    const height = floorEven(Math.min(requested.y + requested.height, display.physical.height) - top);
    const rect = { x: left, y: top, width, height };
    const absolute = { x: display.physical.x + left, y: display.physical.y + top, width, height };
    return {
      capture: { kind: 'area', outputIndex: display.outputIndex, rect,hmonitor:display.hmonitor,monitorWidth:display.physical.width,monitorHeight:display.physical.height,multipleDisplays:displays.length>1 },
      width,
      height,
      getRect: () => absolute,
      description: { ...description, display: display.label, rect },
    };
  };
  if (selection.kind === 'window') {
    bringToFront(selection.hwnd);
    const rects = windowRects(selection.hwnd);
    if (!rects) throw new Error('这个窗口已经关闭或无法访问，请重新选择。');
    const frame=rects.frame,width=Math.max(64,Math.floor(frame.width/2)*2),height=Math.max(64,Math.floor(frame.height/2)*2);
    return{capture:{kind:'window',hwnd:String(selection.hwnd),width,height},width,height,
      getRect:()=>{if(isWindowMinimized(selection.hwnd))return null;const live=windowRects(selection.hwnd)?.frame;if(!live)return null;const aspect=width/height;
        const w=Math.max(live.width,live.height*aspect),h=Math.max(live.height,live.width/aspect);
        return{x:live.x-(w-live.width)/2,y:live.y-(h-live.height)/2,width:w,height:h};},
      description:{source:'window',title:selection.title||'',backend:'windows-graphics-capture'}};
  }
  const display = displays.find((item) => item.id === selection.displayId);
  if (!display) throw new Error('录制显示器已断开或不可用，请重新选择显示器。');
  if (selection.kind === 'area') return areaSource(display, selection.rect, { source: 'area' });
  return {
    capture: { kind: 'display', outputIndex: display.outputIndex,hmonitor:display.hmonitor,monitorWidth:display.physical.width,monitorHeight:display.physical.height,multipleDisplays:displays.length>1 },
    width: display.physical.width,
    height: display.physical.height,
    getRect: () => display.physical,
    description: { source: 'display', display: display.label },
  };
}

class RecordingSession {
  constructor({ projectsRoot, selection, frameRate = 60, name }) {
    this.selection = selection;
    this.frameRate = frameRate;
    this.name = name || defaultProjectName();
    this.directory = uniqueProjectDirectory(projectsRoot, this.name);
    this.root = path.resolve(projectsRoot);
    this.mediaDirectory = path.join(this.directory, 'media');
    this.markers = [];
    this.firstFrameTime = null;
  }

  async start(onInterrupted = () => {}) {
    fs.mkdirSync(this.mediaDirectory, { recursive: true });
    this.writeStatus('starting');
    try {
      this.source = resolveSource(this.selection);
      this.pointer = new PointerRecorder(this.source.getRect);
      this.pointer.start();
      this.capture = await media.startCapture({
        source: this.source.capture,
        fps: this.frameRate,
        file: path.join(this.mediaDirectory, 'screen.mkv'),
        width: this.source.width,
        height: this.source.height,
      });
      let timeout;
      try {this.firstFrameTime = await Promise.race([
        this.capture.firstFrame,
        new Promise((_, reject) => {timeout=setTimeout(() => reject(new Error('屏幕采集启动超时')), 10000);}),
      ]);} finally {clearTimeout(timeout);}
      if(Number.isFinite(this.capture.firstMonotonic))this.pointer.alignClock(this.firstFrameTime,this.capture.firstMonotonic);
      this.health = new (require('./recording-health').RecordingHealth)({screen,selection:this.selection,windowExists:hwnd=>Boolean(windowRects(hwnd)),onInterrupted});
      this.capture.closed.then(()=>{if(!this.finishing)this.health?.interrupt('屏幕采集已停止，正在保存已录内容');});
      this.checkpoint();
      this.checkpointTimer=setInterval(()=>{try{this.checkpoint();}catch(error){this.health?.interrupt(`录制信息写入失败：${error.message}`);}},2000);
    } catch (error) {
      await this.discard();
      throw error;
    }
    return { directory: this.directory, mediaDirectory: this.mediaDirectory, firstFrameTime: this.firstFrameTime, encoder: this.capture.encoder.label };
  }

  writeStatus(status, detail = null) {
    const file=path.join(this.directory,'recording-session.json');
    fs.writeFileSync(`${file}.tmp`,JSON.stringify({status,name:this.name,selection:this.selection,frameRate:this.frameRate,firstFrameTime:this.firstFrameTime,backend:this.capture?.backend,source:this.source?.description,recordedDuration:this.firstFrameTime===null?0:this.capture?.elapsedSeconds??Math.max(0,(this.capture?.stoppedAt||Date.now()/1000)-this.firstFrameTime),tracks:this.trackMetadata||[],markers:this.markers,updatedAt:new Date().toISOString(),detail},null,2));
    fs.renameSync(`${file}.tmp`,file);
  }

  setTracks(tracks){
    this.trackMetadata=(tracks||[]).filter(t=>['camera','microphone','system'].includes(t.kind)&&typeof t.file==='string'&&path.dirname(path.resolve(t.file))===path.resolve(this.mediaDirectory)).map(t=>({kind:t.kind,file:path.basename(t.file),startedAt:t.startedAt,stoppedAt:t.stoppedAt,hasAudio:Boolean(t.hasAudio),problems:t.problems||[]}));
  }

  checkpoint(status='recording'){
    if(this.pointer){
      const events=this.pointer.events||[],from=this.persistedPointers||0;
      if(events.length>from)fs.appendFileSync(path.join(this.mediaDirectory,'pointer-events.ndjson'),events.slice(from).map(event=>JSON.stringify(event)+'\n').join(''));
      this.persistedPointers=events.length;
    }
    this.writeStatus(status);
  }

  addMarker() {
    if (this.firstFrameTime === null) return null;
    const marker = { id: uid(), time: this.capture?.elapsedSeconds??Date.now() / 1000 - this.firstFrameTime };
    this.markers.push(marker);
    return marker;
  }

  async discard() {
    clearInterval(this.checkpointTimer);
    this.finishing=true;
    this.health?.dispose();
    if (this.pointer) this.pointer.stop();
    if (this.capture) await this.capture.stop();
    const target=path.resolve(this.directory);
    if(!target.startsWith(this.root+path.sep)||!target.endsWith(PROJECT_EXTENSION))throw new Error('拒绝删除项目目录之外的路径。');
    fs.rmSync(target, { recursive: true, force: true });
  }

  /// tracks：录制条窗口用 MediaRecorder 写下的附加轨，
  /// [{ kind: 'camera' | 'microphone' | 'system', file, startedAt（系统时钟秒）, hasAudio }]
  async finish(tracks, onStage = () => {}) {
    this.setTracks(tracks);
    try{this.writeStatus('finalizing');}catch(error){console.warn('[DogSC] 将先停止采集，再报告状态写入错误',error);}
    try {
      const result=await this.finishMedia(tracks,onStage);
      try{this.writeStatus('complete');}catch(error){console.warn('[DogSC] 录制已保存，状态文件更新失败',error);}
      return result;
    } catch(error) {
      try{this.writeStatus('failed',String(error.message||error));}catch{}
      throw new Error(`${error.message||error}。原始素材已保留在：${this.directory}`);
    }
  }

  async finishMedia(tracks, onStage = () => {}) {
    clearInterval(this.checkpointTimer);
    this.finishing=true;
    this.health?.dispose();
    onStage('正在结束采集');
    const pointerEvents = this.pointer.stop();
    await this.capture.stop();
    this.checkpoint('finalizing');
    const inMedia = (name) => path.join(this.mediaDirectory, name);
    const raw = inMedia('screen.mkv');

    onStage('正在整理屏幕画面');
    let screenInfo = null;
    try {
      if(this.capture.backend==='wgc')await media.finalizeWindow(raw,inMedia('screen.mp4'),Math.max(0.01,this.capture.stoppedAt-this.firstFrameTime),this.frameRate);
      else await media.remuxToMp4(raw, inMedia('screen.mp4'));
      screenInfo = await media.probe(inMedia('screen.mp4'));
    } catch { /* 下面统一报错 */ }
    if (!screenInfo || !screenInfo.video) {
      throw new Error(`没有录到画面：${this.capture.stderr.trim().split(/\r?\n/).slice(-8).join(' / ')}`);
    }
    const duration = screenInfo.duration;
    const warnings = [...(this.recoveryWarnings||[]),...(tracks||[]).flatMap(track=>(track.problems||[]).map(message=>`${track.kind}：${message}`))];
    const disposable=[];
    const projectMedia = {
      screen: { file: 'media/screen.mp4', index: 'media/screen.index.json', width: screenInfo.video.width, height: screenInfo.video.height, duration, frameRate: this.frameRate },
      camera: null,
      microphone: null,
      systemAudio: null,
    };

    for (const track of tracks || []) {
      if (!fs.existsSync(track.file) || fs.statSync(track.file).size < 512) continue;
      const offset = track.startedAt - this.firstFrameTime;
      try {
        if (track.kind === 'camera') {
          onStage('正在整理摄像头画面');
          const info = await media.finalizeCamera(track.file, inMedia('camera.mp4'));
          if(!info?.video)throw new Error('摄像头文件没有有效画面');
          if (info && info.video) {
            fs.writeFileSync(inMedia('camera.index.json'), JSON.stringify(await media.buildVideoIndex(inMedia('camera.mp4'))));
            projectMedia.camera = { file: 'media/camera.mp4', index: 'media/camera.index.json', width: info.video.width, height: info.video.height, duration: info.duration, offset };
          }
          if (track.hasAudio) {
            const audio = await media.finalizeAudio(track.file, inMedia('microphone.m4a'));
            if (audio) projectMedia.microphone = { file: 'media/microphone.m4a', duration: audio.duration, offset };
            else warnings.push('麦克风文件没有有效音轨');
          }
        } else {
          onStage(track.kind === 'system' ? '正在整理系统声音' : '正在整理麦克风');
          const name = track.kind === 'system' ? 'system.m4a' : 'microphone.m4a';
          const audio = await media.finalizeAudio(track.file, inMedia(name));
          if(!audio)throw new Error('文件没有有效音轨');
          if (audio) projectMedia[track.kind === 'system' ? 'systemAudio' : 'microphone'] = { file: `media/${name}`, duration: audio.duration, offset };
        }
      } catch (error) {
        // 附加轨整理失败不应丢掉整段录屏：保留原始文件，项目里不引用。
        console.error(`[DogSC] ${track.kind} 轨整理失败`, error);
        warnings.push(`${track.kind} 轨整理失败，原始素材已保留：${error.message||error}`);
        continue;
      }
      if(!(track.problems||[]).length && !(track.kind==='camera'&&track.hasAudio&&!projectMedia.microphone))disposable.push(track.file);
    }

    onStage('正在生成索引与缩略图');
    fs.writeFileSync(inMedia('screen.index.json'), JSON.stringify(await media.buildVideoIndex(inMedia('screen.mp4'))));
    projectMedia.thumbnails = await media.makeThumbnails(inMedia('screen.mp4'), inMedia('thumbnails.jpg'), duration)
      .then((thumbnails) => ({ ...thumbnails, file: `media/${thumbnails.file}` }))
      .catch(() => null);

    const events = toSourceTimeline(pointerEvents, this.firstFrameTime, duration);
    fs.writeFileSync(inMedia('pointer.json'), JSON.stringify({ hasClicks: this.pointer.hasClickSupport, events }));
    projectMedia.pointer = 'media/pointer.json';

    const project = makeProject({ name: path.basename(this.directory, PROJECT_EXTENSION), media: projectMedia, capture: this.source.description });
    project.zoomAnimations = planAutoZoom(events.filter(isInside), {
      zoomScale: project.motion.defaultZoomScale,
      easing: project.motion.defaultZoomEasing,
      transitionDuration: project.motion.defaultZoomTransitionDuration,
      duration,
    });
    project.markers = this.markers.filter((marker) => marker.time >= 0 && marker.time <= duration);
    project.recordingWarnings = warnings;
    project.export.frameRate = this.frameRate >= 60 ? 60 : 30;
    require('./project-files').writeProject(this.directory,project);
    for(const file of [...disposable,raw])try{fs.rmSync(file,{force:true});}catch(error){console.warn('[DogSC] 已保存工程，临时素材暂未清理',error);}
    return { directory: this.directory, project };
  }
}

module.exports = { RecordingSession, listDisplays, defaultProjectName, PROJECT_EXTENSION };
