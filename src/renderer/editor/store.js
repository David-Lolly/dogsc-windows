'use strict';
// 编辑器状态：项目文档、选中项、撤销栈与自动保存。

const { ipcRenderer } = require('electron');
const { orderedClips } = require('../../core/zoom');
const { loadPointerTrack } = require('./export');

const HISTORY_LIMIT = 120;

class Store {
  constructor(directory, project) {
    this.directory = directory;
    this.project = project;
    this.pointerTrack = loadPointerTrack(directory, project);
    this.pointerSource=project.media.pointer;
    this.selection = null; // { type: 'segment' | 'zoom', id }
    this.selections = [];
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.gesture = null;
    this.saveTimer = null;
    this.saveState = 'saved';
    this.revision = 0;
    this.saving = null;
    this.refreshDerived();
  }

  refreshDerived() {
    this.zoomClips = orderedClips(this.project.zoomAnimations);
    if(this.pointerSource!==this.project.media.pointer){this.pointerSource=this.project.media.pointer;this.pointerTrack=loadPointerTrack(this.directory,this.project);}
  }

  subscribe(listener) { this.listeners.add(listener); }

  emit(reason) { for (const listener of this.listeners) listener(reason); }

  /// 所有改动都走这里。history 为 false 的改动（拖动过程）不单独进撤销栈。
  mutate(change, { history = true } = {}) {
    const before = history && !this.gesture ? JSON.stringify(this.project) : null;
    const groupTimes=new Map();
    for(const key of ['screenMotionClips','cameraMotionClips'])for(const c of this.project.timeline[key])if(c.groupID)groupTimes.set(c.id,JSON.stringify(c.timing));
    change(this.project);
    const linked=new Set();
    for(const key of ['screenMotionClips','cameraMotionClips'])for(const c of this.project.timeline[key])if(c.groupID&&!linked.has(c.groupID)&&groupTimes.has(c.id)&&groupTimes.get(c.id)!==JSON.stringify(c.timing)){
      linked.add(c.groupID);for(const otherKey of ['screenMotionClips','cameraMotionClips'])for(const partner of this.project.timeline[otherKey])if(partner.groupID===c.groupID&&partner.id!==c.id)partner.timing=JSON.parse(JSON.stringify(c.timing));
    }
    if (before !== null) this.pushUndo(before);
    this.afterChange();
  }

  pushUndo(snapshot) {
    if (snapshot === JSON.stringify(this.project)) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /// 一次拖动（滑块、片段边缘、缩放块）只算一步撤销。
  beginGesture() {
    if (!this.gesture) this.gesture = JSON.stringify(this.project);
  }

  endGesture() {
    if (!this.gesture) return;
    const snapshot = this.gesture;
    this.gesture = null;
    this.pushUndo(snapshot);
    this.emit('history');
  }

  restore(snapshot) {
    this.project = JSON.parse(snapshot);
    if (this.selection) {
      const pool = this.selection.type === 'zoom' ? this.project.zoomAnimations
        : this.selection.type === 'screenMotion' ? this.project.timeline.screenMotionClips
        : ['sticker','mosaic'].includes(this.selection.type) ? this.project.timeline[`${this.selection.type}Clips`]
        : this.selection.type === 'cameraMotion' ? this.project.timeline.cameraMotionClips : this.project.timeline.segments;
      if (!pool.some((item) => item.id === this.selection.id)) this.selection = null;
    }
    this.selections=this.selections.filter(s=>{const pool=s.type==='segment'?this.project.timeline.segments:s.type==='zoom'?this.project.zoomAnimations:this.project.timeline[`${s.type}Clips`];return pool?.some(c=>c.id===s.id);});
    if(!this.selection)this.selection=this.selections.at(-1)||null;
    this.afterChange();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.restore(this.redoStack.pop());
  }

  afterChange() {
    this.refreshDerived();
    this.scheduleSave();
    this.emit('project');
  }

  select(selection,{toggle=false}={}) {
    if(!selection)this.selections=[];
    else if(toggle){const index=this.selections.findIndex(s=>s.type===selection.type&&s.id===selection.id);if(index>=0)this.selections.splice(index,1);else this.selections.push(selection);}
    else this.selections=[selection];
    this.selection = toggle?this.selections.at(-1)||null:selection;
    this.emit('selection');
  }

  isSelected(type,id){return this.selections.some(s=>s.type===type&&s.id===id);}
  selectAllEffects(){this.selections=[];for(const type of ['zoom','screenMotion','cameraMotion','sticker','mosaic'])for(const clip of type==='zoom'?this.project.zoomAnimations:this.project.timeline[`${type}Clips`])this.selections.push({type,id:clip.id});this.selection=this.selections[0]||null;this.emit('selection');}

  copyEffects() {return require('../../core/effect-clipboard').copyEffects(this.project,this.selections,this.directory);}

  deleteSelections(){
    if(!this.selections.length)return false;
    const {segments,entries}=require('../../core/effect-batch').deletionPlan(this.project,this.selections,this.directory);
    this.mutate(project=>{project.timeline.segments=project.timeline.segments.filter(c=>!segments.has(c.id));for(const {type,clip}of entries){const key=type==='zoom'?'zoomAnimations':`${type}Clips`,parent=type==='zoom'?project:project.timeline;parent[key]=parent[key].filter(c=>c.id!==clip.id);}});
    this.select(null);return true;
  }

  pasteEffects(payload,sourceTime) {
    const {planPaste,TYPES}=require('../../core/effect-clipboard');
    const entries=planPaste(this.project,payload,sourceTime,this.directory);
    this.mutate(project=>{for(const {type,clip}of entries){if(clip.animationSlice)project.schema=3;(type==='zoom'?project.zoomAnimations:project.timeline[TYPES[type]]).push(clip);}});
    this.selections=entries.map(({type,clip})=>({type,id:clip.id}));this.selection=this.selections[0];this.emit('selection');
    return entries.length;
  }

  splitSelectedEffects(time){
    const result=require('../../core/effect-slices').splitEffects(this.project,this.selections,time,this.directory);
    this.mutate(project=>Object.assign(project,result.project));
    this.selections=result.selections;this.selection=this.selections[0];this.emit('selection');
  }

  releaseAnimationSlice(type,id){
    const pool=type==='zoom'?this.project.zoomAnimations:this.project.timeline[`${type}Clips`],clip=pool.find(c=>c.id===id);
    if(!clip?.animationSlice)return;
    this.mutate(project=>{for(const kind of ['zoom','screenMotion','cameraMotion'])for(const c of kind==='zoom'?project.zoomAnimations:project.timeline[`${kind}Clips`])if(c.id===id||(clip.groupID&&c.groupID===clip.groupID))delete c.animationSlice;});
  }

  deleteEffect(kind,id){
    const key=`${kind}Clips`,clip=this.project.timeline[key].find(c=>c.id===id);if(!clip)return;
    this.mutate(p=>{p.timeline[key]=p.timeline[key].filter(c=>c.id!==id);
      if(clip.groupID)for(const k of ['screenMotionClips','cameraMotionClips'])p.timeline[k]=p.timeline[k].filter(c=>c.groupID!==clip.groupID);
    });this.select(null);
  }

  get selectedZoom() {
    return this.selection && this.selection.type === 'zoom' ? this.project.zoomAnimations.find((clip) => clip.id === this.selection.id) || null : null;
  }

  get selectedSegment() {
    return this.selection && this.selection.type === 'segment' ? this.project.timeline.segments.find((segment) => segment.id === this.selection.id) || null : null;
  }

  get selectedScreenMotion() {
    return this.selection && this.selection.type === 'screenMotion'
      ? this.project.timeline.screenMotionClips.find((clip) => clip.id === this.selection.id) || null : null;
  }

  scheduleSave() {
    this.revision += 1;
    this.saveState = 'pending';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 500);
  }

  async save() {
    clearTimeout(this.saveTimer);
    if (this.saving) return this.saving;
    if (this.saveState === 'saved') return true;
    this.saving = (async () => {
      for (;;) {
        const revision=this.revision;
        const snapshot=JSON.parse(JSON.stringify(this.project));
        this.saveState='saving';this.emit('save');
        try {await ipcRenderer.invoke('project:write',{directory:this.directory,project:snapshot});}
        catch(error){this.saveState='failed';console.error('[DogSC] 保存失败',error);this.emit('save');return false;}
        if(revision===this.revision){this.saveState='saved';this.emit('save');return true;}
        // An edit arrived while IPC was in flight: write the newest snapshot
        // before reporting success. Only one write per editor can be active.
      }
    })();
    try{return await this.saving;}finally{this.saving=null;}
  }
}

module.exports = { Store };
