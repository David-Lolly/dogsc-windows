'use strict';
const {randomUUID}=require('node:crypto');
const {openingSample}=require('./opening-sequence');
const clamp=(n,a,b)=>Math.min(Math.max(n,a),b);
const curves={smooth:x=>x*x*x*(x*(x*6-15)+10),swift:x=>1-(1-x)**4,gentle:x=>1-(1-x)**3};
const STICKER_ANIMATIONS={none:'无',fade:'淡入淡出',pop:'弹出',slideLeft:'从左',slideRight:'从右',slideUp:'从上',slideDown:'从下',slideTopLeft:'左上',slideTopRight:'右上',slideBottomLeft:'左下',slideBottomRight:'右下'};
const opposite={slideLeft:'slideRight',slideRight:'slideLeft',slideUp:'slideDown',slideDown:'slideUp',slideTopLeft:'slideBottomRight',slideTopRight:'slideBottomLeft',slideBottomLeft:'slideTopRight',slideBottomRight:'slideTopLeft'};
function makeSticker(file,start,duration,layerIndex=0){return{id:randomUUID(),relativePath:file,timing:{startTime:start,duration},position:{x:0.5,y:0.5},width:0.38,rotationDegrees:0,opacity:1,cornerRadius:18,borderWidth:0,borderColor:'#FFFFFF',shadowOpacity:0.28,shadowRadius:24,shadowOffsetX:0,shadowOffsetY:10,animation:'pop',animationCurve:'swift',exitAnimation:null,enterDuration:0.7,exitDuration:0.22,backdropBlur:20,backdropBlurIncludesCamera:false,hidesScreen:false,hidesCamera:false,layerIndex};}
function makeMosaic(start,duration,style='blur'){return{id:randomUUID(),timing:{startTime:start,duration},sourceRect:{x:0.35,y:0.39,width:0.3,height:0.22},cornerRadius:0.08,style,intensity:0.55,spotlightDimming:0.22,transitionStyle:style==='blur'?'none':'smooth',transitionInDuration:0.3,transitionOutDuration:0.3};}
function transitionBudget(clip){const total=clip.enterDuration+clip.exitDuration,scale=total>clip.timing.duration?clip.timing.duration/total:1;return{enter:clip.enterDuration*scale,exit:clip.exitDuration*scale};}
function sampleStickers(project,time,width,height){
  const clips=[...project.timeline.stickerClips].sort((a,b)=>a.layerIndex-b.layerIndex||a.id.localeCompare(b.id));
  const available=['screen',...(project.media.camera&&!project.camera.isHidden?['camera']:[]),...(clips.some(c=>c.timing.startTime<=0.0001)?['stickers']:[])];
  const opening=openingSample(project.openingSequence,'stickers',time,width,height,available);
  const backdrop={screenSuppression:0,cameraSuppression:0,screenBlur:0,cameraBlur:0};
  const treatment=(c,v)=>({screenSuppression:c.hidesScreen?v:0,cameraSuppression:c.hidesCamera?v:0,screenBlur:c.hidesScreen?0:c.backdropBlur*v,cameraBlur:c.backdropBlurIncludesCamera?c.backdropBlur*v:0});
  const merge=(value)=>{for(const key of Object.keys(backdrop))backdrop[key]=Math.max(backdrop[key],value[key]);};
  const joins=[];
  for(const a of clips)for(const b of clips){
    if(a.id===b.id)continue;
    const ae=a.timing.startTime+a.timing.duration;
    if(Math.abs(ae-b.timing.startTime)<1e-7){const x=transitionBudget(a),y=transitionBudget(b);const before=(a.exitAnimation||opposite[a.animation]||a.animation)==='none'?0:x.exit,after=b.animation==='none'?0:y.enter;joins.push({a,b,start:ae-before,end:ae+after});}
    else if(b.timing.startTime<ae&&b.timing.startTime>a.timing.startTime){
      const x=transitionBudget(a),y=transitionBudget(b),start=Math.max(ae-x.exit,b.timing.startTime),end=Math.min(ae,b.timing.startTime+y.enter);
      if(start<end&&time>=start&&time<end){const left=treatment(a,1),right=treatment(b,1);merge(Object.fromEntries(Object.keys(backdrop).map(k=>[k,Math.min(left[k],right[k])])));}
    }
  }
  for(const j of joins)if(time>=j.start&&time<j.end){const t=(curves[j.b.animationCurve]||curves.swift)(clamp((time-j.start)/Math.max(j.end-j.start,1e-9),0,1)),a=treatment(j.a,1),b=treatment(j.b,1);merge(Object.fromEntries(Object.keys(backdrop).map(k=>[k,a[k]+(b[k]-a[k])*t])));}
  const scenes=[];
  for(const c of clips){
    const end=c.timing.startTime+c.timing.duration,budget=transitionBudget(c),entryJoin=joins.find(j=>j.b.id===c.id&&time>=j.start&&time<j.end),exitJoin=joins.find(j=>j.a.id===c.id&&time>=j.start&&time<j.end);
    if(!(time>=c.timing.startTime&&time<end)&&!entryJoin&&!exitJoin)continue;
    const suppress=project.openingSequence?.isEnabled&&project.openingSequence.includedElements.includes('stickers')&&c.timing.startTime<=0.0001&&!entryJoin;
    const enter=entryJoin?(time-entryJoin.start)/Math.max(entryJoin.end-entryJoin.start,1e-9):suppress?1:budget.enter>0?(time-c.timing.startTime)/budget.enter:1;
    const exit=exitJoin?1-(time-exitJoin.start)/Math.max(exitJoin.end-exitJoin.start,1e-9):budget.exit>0?(end-time)/budget.exit:1;
    const ease=curves[c.animationCurve]||curves.swift,ep=ease(clamp(enter,0,1)),xp=ease(clamp(exit,0,1)),exitPreset=c.exitAnimation||opposite[c.animation]||c.animation;
    const visibility=Math.min(c.animation==='none'?1:ep,exitPreset==='none'?1:xp);
    const exiting=Boolean(exitJoin)||(budget.exit>0&&end-time<budget.exit),preset=exiting?exitPreset:c.animation,p=exiting?xp:ep,travel=1-p;
    const outside=Math.max(0.85,c.width/2+0.06),offset={x:0,y:0};
    if(/Left/.test(preset))offset.x=(-outside-c.position.x)*travel;
    if(/Right/.test(preset))offset.x=(1+outside-c.position.x)*travel;
    if(/Up|Top/.test(preset))offset.y=(-outside-c.position.y)*travel;
    if(/Down|Bottom/.test(preset))offset.y=(1+outside-c.position.y)*travel;
    const isOpening=c.timing.startTime<=0.0001;
    scenes.push({...c,opacity:c.opacity*visibility*(isOpening?opening.opacity:1),scale:(preset==='pop'?0.72+0.28*p:1)*(isOpening?opening.scale:1),offset:{x:offset.x+(isOpening?opening.offset.x/width:0),y:offset.y+(isOpening?opening.offset.y/height:0)}});
    if(!entryJoin&&!exitJoin)merge(treatment(c,visibility));
  }
  return{stickers:scenes,backdrop};
}
function sampleMosaics(project,time){return project.timeline.mosaicClips.filter(c=>time>=c.timing.startTime&&time<c.timing.startTime+c.timing.duration).map(c=>{
  let progress=1;if(c.transitionStyle!=='none'){const enter=c.transitionInDuration>0?clamp((time-c.timing.startTime)/c.transitionInDuration,0,1):1,exit=c.transitionOutDuration>0?clamp((c.timing.startTime+c.timing.duration-time)/c.transitionOutDuration,0,1):1;const f=c.transitionStyle==='smooth'?curves.smooth:x=>x;progress=Math.min(f(enter),f(exit));}return{...c,progress};});}
module.exports={STICKER_ANIMATIONS,makeSticker,makeMosaic,sampleStickers,sampleMosaics};
