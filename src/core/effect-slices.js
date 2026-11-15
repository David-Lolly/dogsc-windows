'use strict';
const {randomUUID}=require('node:crypto');
const TYPES={zoom:'zoomAnimations',screenMotion:'screenMotionClips',cameraMotion:'cameraMotionClips'};
const clone=value=>JSON.parse(JSON.stringify(value)),cache=new WeakMap();
const start=(c,type)=>type==='zoom'?c.startTime:c.timing.startTime;
const end=(c,type)=>type==='zoom'?c.endTime:c.timing.startTime+c.timing.duration;
const tail=(c,type)=>type==='zoom'?c.exitDuration:c.timing.returnDuration;
const pool=(p,type)=>type==='zoom'?p.zoomAnimations:p.timeline[TYPES[type]];
function shifted(source,offset){
  let entries=cache.get(source.track);if(!entries){entries=new Map();cache.set(source.track,entries);}
  const key=offset.toFixed(8);if(entries.has(key))return entries.get(key);
  const track=clone(source.track);
  for(const c of track){delete c.animationSlice;if(source.type==='zoom'){c.startTime+=offset;c.endTime+=offset;}else c.timing.startTime+=offset;}
  if(entries.size>=4)entries.delete(entries.keys().next().value);entries.set(key,track);return track;
}
function materializeTrack(clips,type,time){
  if(!clips.some(c=>c.animationSlice))return clips;
  const ordered=[...clips].sort((a,b)=>start(a,type)-start(b,type));
  const latest=[...ordered].reverse().find(c=>start(c,type)<=time);
  if(latest?.animationSlice&&time<end(latest,type)+tail(latest,type))return shifted(latest.animationSlice,start(latest,type)-latest.animationSlice.sampleStart);
  const result=clips.filter(c=>!c.animationSlice),finished=new Set();
  for(const c of clips){
    const s=c.animationSlice;if(!s||time<end(c,type))continue;
    const offset=start(c,type)-s.sampleStart,key=s.id+':'+offset.toFixed(8),original=s.track.find(item=>item.id===s.originalID);
    // Only a fragment reaching the original body end can contribute a held
    // target or an outgoing transition after its visible window.
    if(original&&Math.abs(end(c,type)-(end(original,type)+offset))<1e-6&&!finished.has(key)){
      finished.add(key);result.push(shifted(s,offset).find(item=>item.id===s.originalID));
    }
  }
  return result;
}
function materializeProject(project,time){
  if(!Object.keys(TYPES).some(type=>pool(project,type).some(c=>c.animationSlice)))return project;
  const next={...project,timeline:{...project.timeline}};
  for(const type of Object.keys(TYPES)){const list=materializeTrack(pool(project,type),type,time);if(type==='zoom')next.zoomAnimations=list;else next.timeline[TYPES[type]]=list;}
  return next;
}
function splitEffects(project,selections,time,directory){
  if(!selections.length||selections.some(s=>!Object.hasOwn(TYPES,s.type)))throw Error('请选择缩放、屏幕 3D 或摄像头动画后拆分。');
  const entries=require('./effect-clipboard').copyEffects(project,selections,directory).entries;
  const draft=clone(project),rightSelections=[],groups=new Map();
  for(const {type,clip}of entries){
    const a=start(clip,type),b=end(clip,type);if(time<=a+0.01||time>=b-0.01)continue;
    const original=pool(project,type).find(c=>c.id===clip.id),source=original.animationSlice||{id:randomUUID(),type,originalID:clip.id,sourceDuration:project.media.screen.duration,track:clone(materializeTrack(pool(project,type),type,time)),sampleStart:a};
    const left=clone(clip),right=clone(clip);left.id=randomUUID();right.id=randomUUID();
    left.animationSlice={...source};right.animationSlice={...source,sampleStart:source.sampleStart+time-a};
    if(clip.groupID){if(!groups.has(clip.groupID))groups.set(clip.groupID,[randomUUID(),randomUUID()]);[left.groupID,right.groupID]=groups.get(clip.groupID);}
    if(type==='zoom'){left.endTime=time;left.exitDuration=0;left.enterDuration=Math.min(left.enterDuration,time-a);right.startTime=time;right.enterDuration=Math.max(0,clip.enterDuration-(time-a));}
    else{left.timing.duration=time-a;left.timing.returnDuration=0;left.timing.leadInDuration=Math.min(left.timing.leadInDuration,time-a);right.timing.startTime=time;right.timing.duration=b-time;right.timing.leadInDuration=Math.max(0,clip.timing.leadInDuration-(time-a));}
    const list=pool(draft,type),index=list.findIndex(c=>c.id===clip.id);list.splice(index,1,left,right);rightSelections.push({type,id:right.id});
  }
  if(!rightSelections.length)throw Error('播放头不在所选动画内部，或离边缘太近。');
  draft.schema=3;require('./model').validateProjectContract(draft);return{project:draft,selections:rightSelections};
}
function validateSlice(project,type,clip){
  const s=clip.animationSlice;
  if(!s)return;
  if(project.schema<3||s.type!==type||typeof s.id!=='string'||typeof s.originalID!=='string'||!Number.isFinite(s.sourceDuration)||s.sourceDuration<=0||!Number.isFinite(s.sampleStart)||s.sampleStart<0||s.sampleStart>s.sourceDuration||!Array.isArray(s.track)||!s.track.length||s.track.length>2048||s.track.some(c=>!c||c.animationSlice)||!s.track.some(c=>c.id===s.originalID))throw Error('保留动画进度的数据无效或工程版本过旧。');
  const check={...project,media:{...project.media,screen:{...project.media.screen,duration:Math.max(project.media.screen.duration,s.sourceDuration)}},timeline:{...project.timeline}};
  for(const kind of Object.keys(TYPES)){const stripped=pool(project,kind).map(c=>{const copy={...c};delete copy.animationSlice;return copy;});if(kind==='zoom')check.zoomAnimations=stripped;else check.timeline[TYPES[kind]]=stripped;}
  if(type==='zoom'){
    for(const c of s.track)if(!Number.isFinite(c.startTime)||!Number.isFinite(c.endTime)||c.startTime<0||c.endTime<=c.startTime||c.endTime>s.sourceDuration+1e-6||!Number.isFinite(c.scale)||c.scale<1||c.scale>6||!Number.isFinite(c.enterDuration)||c.enterDuration<0||!Number.isFinite(c.exitDuration)||c.exitDuration<0||!c.focus||![c.focus.x,c.focus.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('缩放采样源无效。');
    check.zoomAnimations=s.track;
  }else check.timeline[TYPES[type]]=s.track;
  require('./model').validateProjectContract(check);
}
module.exports={TYPES,materializeTrack,materializeProject,splitEffects,validateSlice};
