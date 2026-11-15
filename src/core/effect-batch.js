'use strict';
const {copyEffects,TYPES}=require('./effect-clipboard');
const {validateProjectContract}=require('./model');
const clone=value=>JSON.parse(JSON.stringify(value));
function moveEffects(project,entries,delta){
  const draft=clone(project);
  for(const {type,clip}of entries){
    const target=(type==='zoom'?draft.zoomAnimations:draft.timeline[TYPES[type]]).find(c=>c.id===clip.id);if(!target)throw Error('选中的效果已不存在');
    if(type==='zoom'){target.startTime=clip.startTime+delta;target.endTime=clip.endTime+delta;}else target.timing.startTime=clip.timing.startTime+delta;
    const start=type==='zoom'?target.startTime:target.timing.startTime,end=type==='zoom'?target.endTime:start+target.timing.duration;
    if(start<0||end>draft.media.screen.duration+1e-6)throw Error('批量移动超出素材范围');
  }
  const zooms=[...draft.zoomAnimations].sort((a,b)=>a.startTime-b.startTime);
  for(let i=1;i<zooms.length;i++){const a=zooms[i-1],b=zooms[i],gap=b.startTime-a.endTime;if(gap< -1e-6||(gap>1/120&&gap<a.exitDuration-1e-6))throw Error('缩放片段或退出过渡重叠');}
  validateProjectContract(draft);
  return entries.map(({type,clip})=>({type,clip:(type==='zoom'?draft.zoomAnimations:draft.timeline[TYPES[type]]).find(c=>c.id===clip.id)}));
}
function deletionPlan(project,selections,directory){
  const segments=new Set(selections.filter(s=>s.type==='segment').map(s=>s.id));
  if(segments.size>=project.timeline.segments.length)throw Error('至少保留一个屏幕片段');
  const effects=selections.filter(s=>s.type!=='segment');
  const entries=effects.length?copyEffects(project,effects,directory).entries:[];
  return{segments,entries};
}
module.exports={moveEffects,deletionPlan};
