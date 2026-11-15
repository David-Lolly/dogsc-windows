'use strict';
function syncCorrection(reference,time){
  const anchors=[...(reference.syncAnchors||[])].sort((a,b)=>a.sourceTime-b.sourceTime||String(a.id).localeCompare(String(b.id)));
  if(!anchors.length)return{offset:0,slope:0};
  let left={sourceTime:0,offset:0};
  for(const right of anchors){
    if(time<=right.sourceTime){const span=right.sourceTime-left.sourceTime;if(span<=1e-6)return{offset:right.offset,slope:0};const slope=(right.offset-left.offset)/span;return{offset:left.offset+slope*Math.max(0,time-left.sourceTime),slope};}
    left=right;
  }return{offset:left.offset,slope:0};
}
function mediaTime(reference,primaryTime){
  const rate=reference.sourceTimeScale??1,correction=syncCorrection(reference,primaryTime);
  const time=(reference.sourceStartTime||0)+(primaryTime-(reference.startOffset??reference.offset??0))*rate+correction.offset;
  const end=Math.min(reference.duration??Infinity,reference.sourceEndTime??Infinity);
  return{time,rate:rate+correction.slope,inRange:time>=Math.max(0,reference.sourceStartTime||0)&&time<end};
}
function audioPieces(track,segments){
  const pieces=[];
  segments.forEach((segment,index)=>{
    const points=[segment.sourceStart,...(track.syncAnchors||[]).map(a=>a.sourceTime).filter(t=>t>segment.sourceStart&&t<segment.sourceEnd),segment.sourceEnd].sort((a,b)=>a-b);
    for(let j=0;j+1<points.length;j++){
      const start=points[j],end=points[j+1];if(end-start<1e-8)continue;
      const a=mediaTime(track,start).time,b=mediaTime(track,end).time,rate=(b-a)/(end-start),duration=(end-start)/segment.speed;
      if(!(rate>0))throw new Error('媒体同步曲线必须保持时间向前。');
      const sourceStart=Math.max(a,track.sourceStartTime||0,0),sourceEnd=Math.min(b,track.sourceEndTime??Infinity,track.duration??Infinity);
      pieces.push({sourceStart,sourceEnd,tempo:rate*segment.speed,duration,lead:Math.max(0,(sourceStart-a)/(rate*segment.speed)),volume:(track.segmentVolumes?.[index]??1)*(track.volume??1)});
    }
  });return pieces;
}
function tempoFilters(value){const parts=[];while(value>2){parts.push('atempo=2');value/=2;}while(value<0.5){parts.push('atempo=0.5');value*=2;}if(Math.abs(value-1)>1e-8)parts.push(`atempo=${value.toFixed(9)}`);return parts.join(',');}
module.exports={mediaTime,syncCorrection,audioPieces,tempoFilters};
