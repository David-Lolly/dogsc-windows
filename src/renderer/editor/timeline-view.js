'use strict';
// 时间线：标尺与标记、屏幕录制轨（缩略图片段，可分割 / 裁边）、缩放轨（可拖动 / 改长短）。
// 横轴是输出时间；缩放与标记以素材时间保存，绘制时经片段映射到输出时间。

const path = require('node:path');
const { element, icon, formatTime, fileUrl } = require('../common');
const { clamp } = require('../../core/model');
const zoomCore = require('../../core/zoom');
const timeline = require('../../core/timeline');
const { orderedScreenClips } = require('../../core/screen-motion');
const { uid } = require('../../core/model');

const PAD = 14;
const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MIN_ZOOM_CLIP = 0.2;

class TimelineView {
  constructor(store, preview, nodes) {
    this.store = store;
    this.preview = preview;
    this.nodes = nodes; // { scroller, lanes, ruler, screen, zoom, playhead, slider }
    this.zoomLevel = 0;
    this.pps = 60;
    const thumbnails = store.project.media.thumbnails;
    this.sprite = thumbnails ? { ...thumbnails, url: fileUrl(path.join(store.directory, thumbnails.file)) } : null;
    this.waveforms={};require('electron').ipcRenderer.invoke('project:waveforms',store.directory).then(value=>{this.waveforms=value;this.render();}).catch(error=>console.warn('[DogSC] 波形暂不可用',error.message));

    new ResizeObserver(() => this.render()).observe(nodes.scroller);
    store.subscribe((reason) => { if (reason === 'project' || reason === 'selection') this.render(); });
    nodes.slider.addEventListener('input', () => this.setZoom(Number(nodes.slider.value)));
    nodes.scroller.addEventListener('wheel', (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      this.setZoom(clamp(this.zoomLevel - Math.sign(event.deltaY) * 0.06, 0, 1), event.clientX);
    }, { passive: false });

    nodes.ruler.addEventListener('pointerdown', (event) => this.scrub(event));
    for (const lane of [nodes.screen, nodes.zoom]) {
      lane.addEventListener('pointerdown', (event) => {
        if (event.target !== lane) return;
        store.select(null);
        this.scrub(event);
      });
    }
    nodes.zoom.addEventListener('dblclick', (event) => { if (event.target === nodes.zoom) this.addZoomAt(this.timeAt(event.clientX)); });
    nodes.cameraMotion.addEventListener('pointerdown', (event) => { if (event.target === nodes.cameraMotion) this.scrub(event); });
    nodes.cameraMotion.addEventListener('dblclick', (event) => { if (event.target === nodes.cameraMotion) this.addCameraMotionAt(this.timeAt(event.clientX)); });
    nodes.screenMotion.addEventListener('pointerdown', (event) => { if (event.target === nodes.screenMotion) this.scrub(event); });
    nodes.screenMotion.addEventListener('dblclick', (event) => {
      if (event.target === nodes.screenMotion) this.addScreenMotionAt(this.timeAt(event.clientX));
    });
    this.render();
  }

  get segments() { return this.store.project.timeline.segments; }

  get duration() { return timeline.outputDuration(this.segments); }

  x(outputTime) { return PAD + outputTime * this.pps; }

  timeAt(clientX) {
    const bounds = this.nodes.lanes.getBoundingClientRect();
    return clamp((clientX - bounds.left - PAD) / this.pps, 0, this.duration);
  }

  setZoom(level, anchorClientX) {
    const anchorTime = anchorClientX === undefined ? this.preview.time : this.timeAt(anchorClientX);
    const anchorOffset = this.x(anchorTime) - this.nodes.scroller.scrollLeft;
    this.zoomLevel = level;
    this.nodes.slider.value = level;
    this.render();
    this.nodes.scroller.scrollLeft = this.x(anchorTime) - anchorOffset;
  }

  /// 拖动通用逻辑：move(dx 像素, 事件)。整个拖动只记一步撤销。
  drag(event, { move, end, gesture = true }) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    if (gesture) this.store.beginGesture();
    const onMove = (moveEvent) => {this.dragShift=Boolean(moveEvent.shiftKey);move(moveEvent.clientX - startX, moveEvent);};
    const onUp = (upEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (gesture) this.store.endGesture();
      if (end) end(upEvent.clientX - startX);
      this.dragShift=false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  scrub(event) {
    this.preview.pause();
    this.preview.seek(this.timeAt(event.clientX));
    this.drag(event, { gesture: false, move: (dx, moveEvent) => this.preview.seek(this.timeAt(moveEvent.clientX)) });
  }

  render() {
    const { scroller, lanes, slider } = this.nodes;
    const duration = Math.max(this.duration, 0.1);
    const available = Math.max(scroller.clientWidth - PAD * 2, 100);
    // 0 档正好铺满可视宽度，1 档放大到约 40 倍。
    this.pps = (available / duration) * (1 + this.zoomLevel * this.zoomLevel * 39);
    lanes.style.width = `${Math.max(duration * this.pps + PAD * 2, scroller.clientWidth)}px`;
    slider.value = this.zoomLevel;
    this.renderRuler(duration);
    this.renderSegments();
    this.renderZoomClips();
    this.renderScreenMotionClips();
    this.renderMotionClips('cameraMotion');
    this.renderOverlayClips('sticker');this.renderOverlayClips('mosaic');
    this.updatePlayhead();
  }

  renderRuler(duration) {
    const step = TICK_STEPS.find((value) => value * this.pps >= 72) || TICK_STEPS[TICK_STEPS.length - 1];
    const nodes = [];
    for (let n = 0; n * step <= duration + 1e-6; n++) {
      const time = n * step;
      nodes.push(element('div', { class: 'tick', style: `left:${this.x(time)}px` }, step < 1 ? formatTime(time).slice(1) : formatTime(time, false)));
      const half = time + step / 2;
      if (half < duration && step * this.pps >= 110) nodes.push(element('div', { class: 'tick minor', style: `left:${this.x(half)}px` }));
    }
    for (const marker of this.store.project.markers) {
      if (!timeline.isRetained(this.segments, marker.time)) continue;
      const outputTime = timeline.sourceToOutput(this.segments, marker.time);
      nodes.push(element('div', {
        class: 'marker', style: `left:${this.x(outputTime)}px`, html: icon('flag'), title: `录制标记 ${formatTime(outputTime)} · 右键删除`,
        onpointerdown: (event) => { event.stopPropagation(); this.preview.seek(outputTime); },
        oncontextmenu: () => this.store.mutate((project) => { project.markers = project.markers.filter((item) => item.id !== marker.id); }),
      }));
    }
    this.nodes.ruler.replaceChildren(...nodes);
  }

  filmstrip(segment, width, height) {
    if (!this.sprite) return null;
    const { media } = this.store.project;
    const tileWidth = height * media.screen.width / media.screen.height;
    const tiles = [];
    for (let left = 0; left < width; left += tileWidth) {
      const sourceTime = segment.sourceStart + ((left + tileWidth / 2) / this.pps) * segment.speed;
      const index = clamp(Math.floor(sourceTime / this.sprite.interval), 0, this.sprite.count - 1);
      tiles.push(element('i', { style: `width:${tileWidth}px;background-image:url("${this.sprite.url}");background-size:${tileWidth * this.sprite.count}px ${height}px;background-position:${-index * tileWidth}px 0` }));
    }
    return element('div', { class: 'film' }, tiles);
  }

  snapSource(value,id,speed=1){
    const excluded=new Set(Array.isArray(id)?id:[id]);
    if(this.dragShift)return value;const p=this.store.project,points=[0,p.media.screen.duration,this.preview.sourceTime,...p.markers.map(m=>m.time)];
    for(const s of p.timeline.segments)if(!excluded.has(s.id))points.push(s.sourceStart,s.sourceEnd);
    for(const z of p.zoomAnimations)if(!excluded.has(z.id))points.push(z.startTime,z.endTime);
    for(const key of ['screenMotionClips','cameraMotionClips','stickerClips','mosaicClips'])for(const c of p.timeline[key])if(!excluded.has(c.id))points.push(c.timing.startTime,c.timing.startTime+c.timing.duration);
    return timeline.snapTime(value,points,8/this.pps*speed);
  }

  waveform(segment,width){
    if(this.store.project.timeline.showWaveforms===false||!Object.keys(this.waveforms).length)return null;
    const canvas=element('canvas',{class:'audio-waveform',width:Math.max(2,Math.min(4096,Math.ceil(width))),height:24,style:`width:${width}px`}),ctx=canvas.getContext('2d');
    const {mediaTime}=require('../../core/media-time'),{segmentVolume}=require('../../core/segment-audio');
    for(const [kind,color]of [['microphone','#5ae2bb'],['systemAudio','#9ab9ff']]){
      const wave=this.waveforms[kind],reference=this.store.project.media[kind];if(!wave||!reference)continue;ctx.strokeStyle=color;ctx.beginPath();
      const volume=segmentVolume(this.store.project,segment,kind);
      for(let x=0;x<canvas.width;x++){const time=segment.sourceStart+x/canvas.width*(segment.sourceEnd-segment.sourceStart),mapped=mediaTime(reference,time),peak=mapped.inRange?(wave.peaks[Math.floor(mapped.time/wave.binSeconds)]||0)*volume:0;ctx.moveTo(x,12-peak*11);ctx.lineTo(x,12+peak*11);}ctx.stroke();
    }return canvas;
  }

  renderSegments() {
    const lane = this.nodes.screen;
    const height = lane.clientHeight - 20;
    const mediaDuration = this.store.project.media.screen.duration;
    let start = 0;
    const nodes = this.segments.map((segment) => {
      const duration = timeline.segmentOutputDuration(segment);
      const width = Math.max(duration * this.pps - 2, 6);
      const selected = this.store.isSelected('segment',segment.id);
      const trim = (edge) => (event) => {
        const original = segment[edge === 'start' ? 'sourceStart' : 'sourceEnd'];
        this.store.select({ type: 'segment', id: segment.id });
        this.drag(event, {
          move: (dx) => this.store.mutate((project) => {
            const next = timeline.trimSegment(project.timeline.segments, segment.id, edge, this.snapSource(original + (dx / this.pps) * segment.speed,segment.id,segment.speed), mediaDuration);
            if (next) project.timeline.segments = next;
          }, { history: false }),
        });
      };
      const node = element('div', {
        class: `segment${selected ? ' selected' : ''}`, style: `left:${this.x(start)}px;width:${width}px`,
        onpointerdown: (event) => {
          if(event.ctrlKey||event.metaKey||event.shiftKey){event.preventDefault();event.stopPropagation();this.store.select({type:'segment',id:segment.id},{toggle:true});return;}
          this.store.select({ type: 'segment', id: segment.id });
          if(event.altKey){const origin=this.segments.findIndex(c=>c.id===segment.id),output=timeline.sourceToOutput(this.segments,segment.sourceStart);this.drag(event,{gesture:false,move:()=>{},end:dx=>{const target=timeline.locate(this.segments,clamp(output+dx/this.pps,0,this.duration)).index;if(target!==origin)this.store.mutate(p=>{p.timeline.segments=timeline.reorderSegment(p.timeline.segments,segment.id,target);});}});return;}
          this.scrub(event);
        },
        oncontextmenu:async(event)=>{
          event.preventDefault();this.store.select({type:'segment',id:segment.id});
          const index=this.segments.findIndex(c=>c.id===segment.id),right=this.segments[index+1];
          const action=await require('electron').ipcRenderer.invoke('recorder:menu',[{id:'left',label:'向前移动',enabled:index>0},{id:'right',label:'向后移动',enabled:index<this.segments.length-1},{id:'restore',label:'恢复到下一片段的剪切',enabled:Boolean(right&&timeline.restoreGap(this.segments,segment.id,right.id))}]);
          if(action==='left'||action==='right')this.store.mutate(p=>{p.timeline.segments=timeline.reorderSegment(p.timeline.segments,segment.id,index+(action==='left'?-1:1));});
          if(action==='restore'&&right)this.store.mutate(p=>{const next=timeline.restoreGap(p.timeline.segments,segment.id,right.id);if(next)p.timeline.segments=next;});
        },
      },
      this.filmstrip(segment, width, height),
      this.waveform(segment,width),
      element('span', { class: 'tag' }, `${formatTime(duration)}${Math.abs(segment.speed - 1) > 1e-6 ? ` · ${segment.speed}×` : ''}`),
      element('div', { class: 'handle start', title: '拖动裁短或恢复', onpointerdown: trim('start') }),
      element('div', { class: 'handle end', title: '拖动裁短或恢复', onpointerdown: trim('end') }));
      start += duration;
      return node;
    });
    lane.replaceChildren(...nodes);
  }

  /// 缩放块在素材时间上可移动的范围：不越过相邻缩放块（含对方的退出过渡）与素材两端。
  zoomBounds(clip) {
    const ordered = this.store.zoomClips;
    const index = ordered.findIndex((item) => item.id === clip.id);
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    return {
      lower: previous ? zoomCore.effectEndTime(previous) : 0,
      upper: (next ? next.startTime : this.store.project.media.screen.duration) - clip.exitDuration,
    };
  }

  speedAt(sourceTime) {
    const segment = this.segments.find((item) => sourceTime >= item.sourceStart && sourceTime <= item.sourceEnd);
    return segment ? segment.speed : 1;
  }

  beginEffectEdit(event,type,clip,mode){
    if(event.shiftKey||event.ctrlKey||event.metaKey){event.preventDefault();event.stopPropagation();this.store.select({type,id:clip.id},{toggle:true});this.preview.pause();return true;}
    if(mode==='move'&&this.store.selections.length>1&&this.store.isSelected(type,clip.id)){
      let entries;try{entries=this.store.copyEffects().entries;}catch(error){this.preview.onError(error);return true;}
      const original=type==='zoom'?clip.startTime:clip.timing.startTime,speed=this.speedAt(original);this.preview.pause();
      this.drag(event,{move:dx=>{
        const delta=this.snapSource(original+dx/this.pps*speed,entries.map(e=>e.clip.id),speed)-original;
        let moved;try{moved=require('../../core/effect-batch').moveEffects(this.store.project,entries,delta);}catch{return;}
        this.store.mutate(project=>{for(const {type,clip:next}of moved){const target=(type==='zoom'?project.zoomAnimations:project.timeline[`${type}Clips`]).find(c=>c.id===next.id);if(type==='zoom'){target.startTime=next.startTime;target.endTime=next.endTime;}else target.timing=next.timing;}},{history:false});
      }});return true;
    }
    return false;
  }

  renderZoomClips() {
    const nodes = [];
    for (const clip of this.store.zoomClips) {
      for(const span of timeline.retainedSpans(this.segments,clip.startTime,clip.endTime)){
      const outputStart=span.outputStart,outputEnd=span.outputEnd;
      if (outputEnd - outputStart < 0.02) continue; // 整段都被剪掉了
      const selected = this.store.isSelected('zoom',clip.id);
      const edit = (mode) => (event) => {
        if(this.beginEffectEdit(event,'zoom',clip,mode))return;
        const original = { start: clip.startTime, end: clip.endTime };
        const bounds = this.zoomBounds(clip);
        const speed = this.speedAt(clip.startTime);
        this.store.select({ type: 'zoom', id: clip.id });
        this.preview.pause();
        this.drag(event, {
          move: (dx) => this.store.mutate((project) => {
            const target = project.zoomAnimations.find((item) => item.id === clip.id);
            const delta = (dx / this.pps) * speed;
            if (mode === 'move') {
              const shift = clamp(this.snapSource(original.start+delta,clip.id,speed)-original.start, bounds.lower - original.start, Math.max(bounds.upper - original.end, bounds.lower - original.start));
              target.startTime = original.start + shift;
              target.endTime = original.end + shift;
            } else if (mode === 'start') {
              target.startTime = clamp(original.start + delta, bounds.lower, original.end - MIN_ZOOM_CLIP);
            } else {
              target.endTime = clamp(original.end + delta, original.start + MIN_ZOOM_CLIP, Math.max(bounds.upper, original.start + MIN_ZOOM_CLIP));
            }
          }, { history: false }),
        });
      };
      const left = this.x(outputStart);
      const width = Math.max((outputEnd - outputStart) * this.pps, 8);
      nodes.push(element('div', {
        class: `zoom-clip${selected ? ' selected' : ''}`, style: `left:${left}px;width:${width}px`,
        title: '拖动移动，拖两端改长短', onpointerdown: edit('move'),
      },
      `缩放 ${clip.scale.toFixed(1)}× · ${clip.origin === 'automatic' ? '自动' : '手动'}`,
      !clip.animationSlice ? element('div', { class: 'handle start', onpointerdown: edit('start') }) : null,
      !clip.animationSlice ? element('div', { class: 'handle end', onpointerdown: edit('end') }) : null));
      if (clip.exitDuration > 0.02 && Math.abs(span.sourceEnd-clip.endTime)<1e-6) {
        // 斜纹表示片段结束后的回落过渡。
        nodes.push(element('div', { class: 'zoom-tail', title:'缩放退出过渡：点击选择对应缩放', style: `left:${left + width}px;width:${clip.exitDuration / this.speedAt(clip.endTime) * this.pps}px`,onpointerdown:event=>{event.stopPropagation();this.preview.pause();this.store.select({type:'zoom',id:clip.id},{toggle:event.ctrlKey||event.metaKey||event.shiftKey});} }));
      }
      }
    }
    this.nodes.zoom.replaceChildren(...nodes);
  }

  renderOverlayClips(kind){
    const nodes=[];
    for(const clip of this.store.project.timeline[`${kind}Clips`]){
      const t=clip.timing;for(const span of timeline.retainedSpans(this.segments,t.startTime,t.startTime+t.duration)){const start=span.outputStart,end=span.outputEnd;
      if(end-start<0.01)continue;
      const edit=(mode)=>(event)=>{
        if(this.beginEffectEdit(event,kind,clip,mode))return;
        const original={...t};this.store.select({type:kind,id:clip.id});this.onOverlaySelected?.(kind);this.preview.pause();
        this.drag(event,{move:(dx)=>this.store.mutate((p)=>{
          const target=p.timeline[`${kind}Clips`].find(c=>c.id===clip.id).timing,delta=dx/this.pps*this.speedAt(original.startTime),limit=p.media.screen.duration;
          if(mode==='move')target.startTime=clamp(this.snapSource(original.startTime+delta,clip.id,this.speedAt(original.startTime)),0,limit-original.duration);
          else if(mode==='start'){target.startTime=clamp(original.startTime+delta,0,original.startTime+original.duration-0.1);target.duration=original.startTime+original.duration-target.startTime;}
          else target.duration=clamp(original.duration+delta,0.1,limit-original.startTime);
        },{history:false})});
      };
      nodes.push(element('div',{class:`zoom-clip${this.store.isSelected(kind,clip.id)?' selected':''}`,style:`left:${this.x(start)}px;width:${Math.max(8,(end-start)*this.pps)}px`,onpointerdown:edit('move')},
        kind==='sticker'?`贴图 · ${clip.layerIndex}`:clip.style==='spotlight'?'突出':'柔化',element('div',{class:'handle start',onpointerdown:edit('start')}),element('div',{class:'handle end',onpointerdown:edit('end')})));
      }
    }
    this.nodes[kind].replaceChildren(...nodes);
  }

  renderScreenMotionClips() { this.renderMotionClips('screenMotion'); }

  renderMotionClips(kind) {
    const key = `${kind}Clips`;
    const clips = orderedScreenClips(this.store.project.timeline[key]);
    const nodes = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i], t = clip.timing;
      for(const span of timeline.retainedSpans(this.segments,t.startTime,t.startTime+t.duration)){
      const start=span.outputStart,end=span.outputEnd;
      if (end - start < 0.02) continue;
      const selected = this.store.isSelected(kind,clip.id);
      const edit = (mode) => (event) => {
        if(this.beginEffectEdit(event,kind,clip,mode))return;
        const original = { ...t };
        const previous = clips[i - 1], next = clips[i + 1];
        let lower = previous ? previous.timing.startTime + previous.timing.duration + previous.timing.returnDuration : 0;
        let upper = next ? next.timing.startTime : this.store.project.media.screen.duration;
        if(clip.groupID){for(const otherKey of ['screenMotionClips','cameraMotionClips']){const others=orderedScreenClips(this.store.project.timeline[otherKey]),partnerIndex=others.findIndex(c=>c.groupID===clip.groupID);if(partnerIndex<0)continue;const before=others[partnerIndex-1],after=others[partnerIndex+1];if(before)lower=Math.max(lower,before.timing.startTime+before.timing.duration+before.timing.returnDuration);if(after)upper=Math.min(upper,after.timing.startTime);}}
        this.store.select({ type: kind, id: clip.id });
        if (kind === 'screenMotion') this.onScreenMotionSelected?.(); else this.onCameraMotionSelected?.();
        this.preview.pause();
        this.drag(event, { move: (dx) => this.store.mutate((project) => {
          const target = project.timeline[key].find((item) => item.id === clip.id).timing;
          const delta = dx / this.pps * this.speedAt(original.startTime);
          if (mode === 'move') target.startTime = clamp(this.snapSource(original.startTime + delta,clip.id,this.speedAt(original.startTime)), Math.min(lower, original.startTime),
            Math.max(original.startTime, upper - original.duration - original.returnDuration));
          else if (mode === 'start') {
            target.startTime = clamp(this.snapSource(original.startTime + delta,clip.id,this.speedAt(original.startTime)), Math.min(lower, original.startTime), original.startTime + original.duration - 0.1);
            target.duration = original.startTime + original.duration - target.startTime;
            target.leadInDuration = Math.min(target.leadInDuration, target.duration);
          } else {
            target.duration = clamp(original.duration + delta, 0.1, Math.max(0.1, upper - original.startTime - original.returnDuration));
            target.leadInDuration = Math.min(target.leadInDuration, target.duration);
          }
        }, { history: false }) });
      };
      nodes.push(element('div', { class: `zoom-clip${selected ? ' selected' : ''}`,
        style: `left:${this.x(start)}px;width:${Math.max((end-start)*this.pps,8)}px`,
        title: '拖动移动，拖两端调整时长', onpointerdown: edit('move') },
      kind === 'screenMotion' ? `3D · X ${clip.target.rotationX}° / Y ${clip.target.rotationY}°` : `摄像头 · ${clip.target.layout.kind === 'fullscreen' ? '全屏' : '布局'}`, 
      !clip.animationSlice ? element('div', { class: 'handle start', onpointerdown: edit('start') }) : null,
      !clip.animationSlice ? element('div', { class: 'handle end', onpointerdown: edit('end') }) : null));
      }
    }
    this.nodes[kind].replaceChildren(...nodes);
  }

  addScreenMotionAt(outputTime) { return this.addMotionAt(outputTime,'screenMotion'); }
  addCameraMotionAt(outputTime) { return this.addMotionAt(outputTime,'cameraMotion'); }

  addPairedLayout(outputTime){
    const p=this.store.project;if(!p.media.camera)return false;const start=timeline.locate(this.segments,outputTime).sourceTime;
    const clips=[...p.timeline.screenMotionClips,...p.timeline.cameraMotionClips];
    if(clips.some(c=>start>=c.timing.startTime-0.01&&start<c.timing.startTime+c.timing.duration+c.timing.returnDuration+0.01))return false;
    const limit=Math.min(p.media.screen.duration,...clips.filter(c=>c.timing.startTime>start).map(c=>c.timing.startTime)),available=limit-start;if(available<0.2)return false;
    const duration=Math.min(2,available*0.75),timing={startTime:start,duration,leadInDuration:Math.min(0.7,duration),returnDuration:Math.min(0.7,available-duration),easing:'spring'},groupID=uid();
    const screen={id:uid(),groupID,timing:{...timing},target:{position:{x:0.3,y:0.5},scale:0.75,rotationX:0,rotationY:-12,rotationZ:0,perspective:0.65}};
    const camera={id:uid(),groupID,timing:{...timing},target:{layout:{kind:'shape',shape:'original'},position:{x:0.95,y:0.5},size:0.5,roundness:0.5,opacity:1}};
    this.store.mutate(p=>{p.timeline.screenMotionClips.push(screen);p.timeline.cameraMotionClips.push(camera);});this.store.select({type:'cameraMotion',id:camera.id});this.onCameraMotionSelected?.();this.preview.seek(timeline.sourceToOutput(this.segments,start+timing.leadInDuration));return true;
  }

  addMotionAt(outputTime,kind) {
    const key = `${kind}Clips`;
    if (kind === 'cameraMotion' && !this.store.project.media.camera) return false;
    const project = this.store.project;
    const sourceTime = timeline.locate(this.segments, outputTime).sourceTime;
    const clips = orderedScreenClips(project.timeline[key]);
    if (clips.some(({ timing: t }) => sourceTime >= t.startTime - 0.01 && sourceTime < t.startTime + t.duration + t.returnDuration + 0.01)) return false;
    const next = clips.find((clip) => clip.timing.startTime > sourceTime);
    const available = (next ? next.timing.startTime : project.media.screen.duration) - sourceTime;
    if (available < 0.2) return false;
    const duration = Math.min(2, available * 0.75);
    const clip = { id: uid(), timing: { startTime: sourceTime, duration, leadInDuration: Math.min(0.7, duration),
      returnDuration: Math.min(0.7, available-duration), easing: 'spring', leadInProgressOffset: 0, returnProgressOffset: 0 },
      target: { position: { x: 0.5, y: 0.5 }, scale: project.canvas.contentScale, rotationX: 10, rotationY: -20, rotationZ: 0, perspective: 0.65 } };
    if (kind === 'cameraMotion') clip.target = { layout: { kind: 'shape', shape: project.camera.shape }, position: { ...project.camera.position }, size: project.camera.size, roundness: project.camera.roundness, opacity: 1 };
    this.store.mutate((draft) => { draft.timeline[key].push(clip); });
    this.store.select({ type: kind, id: clip.id });
    if (kind === 'screenMotion') this.onScreenMotionSelected?.(); else this.onCameraMotionSelected?.();
    this.preview.seek(timeline.sourceToOutput(this.segments, sourceTime + clip.timing.leadInDuration));
    return true;
  }

  /// 在输出时间处添加一段手动缩放。位置被已有缩放占用时返回 false。
  addZoomAt(outputTime) {
    const { project, pointerTrack, zoomClips } = this.store;
    const sourceTime = timeline.locate(this.segments, outputTime).sourceTime;
    if (zoomClips.some((clip) => sourceTime >= clip.startTime - 0.05 && sourceTime <= zoomCore.effectEndTime(clip) + 0.05)) return false;
    const next = zoomClips.find((clip) => clip.startTime > sourceTime);
    const transition = project.motion.defaultZoomTransitionDuration;
    const limit = (next ? next.startTime : project.media.screen.duration) - 0.05;
    const endTime = Math.min(sourceTime + 2, limit - Math.min(transition, 0.3));
    if (endTime - sourceTime < MIN_ZOOM_CLIP) return false;
    // 默认对准当时指针所在的位置。
    const pointer = pointerTrack ? pointerTrack.evaluation(sourceTime, project.motion, project.cursorStyle).position : null;
    const clip = zoomCore.makeClip({
      startTime: sourceTime, endTime, scale: project.motion.defaultZoomScale, focus: pointer || zoomCore.CENTER, origin: 'manual',
      easing: project.motion.defaultZoomEasing, enterDuration: transition, exitDuration: Math.min(transition, limit - endTime),
    });
    this.store.mutate((draft) => { draft.zoomAnimations.push(clip); });
    this.store.select({ type: 'zoom', id: clip.id });
    return true;
  }

  updatePlayhead() {
    const { scroller, playhead } = this.nodes;
    const x = this.x(this.preview.time);
    playhead.style.transform = `translateX(${x}px)`;
    if (this.preview.playing && (x < scroller.scrollLeft + 20 || x > scroller.scrollLeft + scroller.clientWidth - 30)) {
      scroller.scrollLeft = x - 60;
    }
  }
}

module.exports = { TimelineView };
