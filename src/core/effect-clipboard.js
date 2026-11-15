'use strict';
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {validateProjectContract}=require('./model');
const TYPES={zoom:'zoomAnimations',screenMotion:'screenMotionClips',cameraMotion:'cameraMotionClips',sticker:'stickerClips',mosaic:'mosaicClips'};
const clone=value=>JSON.parse(JSON.stringify(value));
const pool=(project,type)=>type==='zoom'?project.zoomAnimations:project.timeline[TYPES[type]];
const start=entry=>entry.type==='zoom'?entry.clip.startTime:entry.clip.timing?.startTime;
const end=entry=>entry.type==='zoom'?entry.clip.endTime:entry.clip.timing?.startTime+entry.clip.timing?.duration;

function copyEffects(project,selection,directory){
  const requested=Array.isArray(selection)?selection:[selection],entries=[],seen=new Set();
  const add=(type,clip)=>{const key=`${type}:${clip.id}`;if(!seen.has(key)){seen.add(key);entries.push({type,clip:clone(clip)});}};
  if(!requested.length)throw new Error('请先选中效果片段。');
  for(const selected of requested){
    if(!selected||!Object.hasOwn(TYPES,selected.type))throw new Error('请只选择缩放、3D、摄像头动画、贴图或区域效果后复制。');
    const clip=pool(project,selected.type).find(c=>c.id===selected.id);if(!clip)throw new Error('选中的效果已不存在。');add(selected.type,clip);
    if(clip.groupID&&['screenMotion','cameraMotion'].includes(selected.type))for(const type of ['screenMotion','cameraMotion'])for(const partner of pool(project,type))if(partner.groupID===clip.groupID)add(type,partner);
  }
  return{version:entries.some(e=>e.clip.animationSlice)?2:1,sourceDirectory:path.resolve(directory),anchor:Math.min(...entries.map(start)),entries};
}

function validatePayload(payload){
  if(!payload||![1,2].includes(payload.version)||!Number.isFinite(payload.anchor)||!Array.isArray(payload.entries)||!payload.entries.length||payload.entries.length>512||typeof payload.sourceDirectory!=='string')throw new Error('剪贴板中没有可粘贴的 DogSC 效果。');
  for(const e of payload.entries)if(!e||!Object.hasOwn(TYPES,e.type)||!e.clip||!Number.isFinite(start(e))||!Number.isFinite(end(e))||end(e)<=start(e))throw new Error('剪贴板中的效果数据无效。');
  if(JSON.stringify(payload).length>1024*1024)throw new Error('剪贴板效果数据过大。');
  return payload;
}

function planPaste(project,payload,sourceTime,directory,{allowForeignStickers=false}={}){
  validatePayload(payload);
  if(!Number.isFinite(sourceTime))throw new Error('播放头位置无效。');
  const draft=clone(project),entries=clone(payload.entries),shift=sourceTime-payload.anchor,groups=new Map();
  for(const entry of entries){
    const c=entry.clip;c.id=randomUUID();
    if(c.groupID){if(!groups.has(c.groupID))groups.set(c.groupID,randomUUID());c.groupID=groups.get(c.groupID);}
    if(entry.type==='zoom'){
      c.startTime+=shift;c.endTime+=shift;
      if(!Number.isFinite(c.exitDuration)||c.exitDuration<0||!Number.isFinite(c.enterDuration)||c.enterDuration<0||!Number.isFinite(c.scale)||c.scale<1||c.scale>6||!c.focus||![c.focus.x,c.focus.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('剪贴板中的缩放参数无效。');
    }else c.timing.startTime+=shift;
    if(start(entry)<-1e-6||end(entry)>project.media.screen.duration+1e-6)throw new Error('当前位置剩余时长不足，无法保留完整效果；请移动播放头。');
    if(entry.type==='cameraMotion'&&!project.media.camera)throw new Error('当前工程没有摄像头素材，无法粘贴摄像头动画。');
    if(entry.type==='sticker'){
      if(!allowForeignStickers&&path.resolve(directory).toLowerCase()!==path.resolve(payload.sourceDirectory).toLowerCase())throw new Error('跨工程贴图需先复制素材，请使用编辑器粘贴命令。');
      c.layerIndex=Math.max(-1,...draft.timeline.stickerClips.map(item=>item.layerIndex))+1;
    }
    pool(draft,entry.type).push(c);
    if(c.animationSlice)draft.schema=3;
  }
  // Zoom validation includes the return tail. Motion tracks have their own
  // adjacency rules in validateProjectContract; overlays may intentionally overlap.
  const zooms=[...draft.zoomAnimations].sort((a,b)=>a.startTime-b.startTime);
  for(let i=1;i<zooms.length;i++){
    const previous=zooms[i-1],next=zooms[i],gap=next.startTime-previous.endTime;
    if(gap< -1e-6||(gap>1/120&&gap<previous.exitDuration-1e-6))throw new Error('此处与已有缩放或退出过渡重叠，请移动播放头。');
  }
  try{validateProjectContract(draft);}catch(error){throw new Error(`无法粘贴：${error.message} 请检查同轨效果是否冲突。`);}
  return entries;
}
module.exports={copyEffects,planPaste,validatePayload,TYPES};
