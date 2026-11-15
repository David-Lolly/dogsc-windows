'use strict';
// 主轨剪辑：片段是素材时间区间 [sourceStart, sourceEnd) 加播放速度，按素材顺序排列。
// 缩放、光标、标记都以素材时间保存，剪切后自动跟随所在画面。

const { clamp, uid } = require('./model');

const MIN_SEGMENT = 0.1;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const segmentOutputDuration = (segment) => (segment.sourceEnd - segment.sourceStart) / segment.speed;
const outputDuration = (segments) => segments.reduce((sum, segment) => sum + segmentOutputDuration(segment), 0);

/// 输出时间 → 所在片段与素材时间。超出末尾时停在最后一帧。
function locate(segments, outputTime) {
  let start = 0;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const duration = segmentOutputDuration(segment);
    if (outputTime < start + duration || index === segments.length - 1) {
      const local = clamp(outputTime - start, 0, duration);
      return { index, segment, outputStart: start, sourceTime: segment.sourceStart + local * segment.speed };
    }
    start += duration;
  }
  return null;
}

/// 素材时间 → 输出时间。落在被剪掉的区间时，吸附到其后第一段的起点。
function sourceToOutput(segments, sourceTime) {
  let start=0,nearest=null;
  for(const segment of segments){
    if(sourceTime>=segment.sourceStart&&sourceTime<segment.sourceEnd)return start+(sourceTime-segment.sourceStart)/segment.speed;
    if(sourceTime===segment.sourceEnd)nearest=nearest||{distance:0,output:start+segmentOutputDuration(segment)};
    if(segment.sourceStart>sourceTime&&(!nearest||segment.sourceStart-sourceTime<nearest.distance))nearest={distance:segment.sourceStart-sourceTime,output:start};
    start+=segmentOutputDuration(segment);
  }
  return nearest?nearest.output:start;
}

function retainedSpans(segments,sourceStart,sourceEnd){
  const spans=[];let output=0;
  for(const segment of segments){const start=Math.max(sourceStart,segment.sourceStart),end=Math.min(sourceEnd,segment.sourceEnd);
    if(end>start)spans.push({sourceStart:start,sourceEnd:end,outputStart:output+(start-segment.sourceStart)/segment.speed,outputEnd:output+(end-segment.sourceStart)/segment.speed,segment});
    output+=segmentOutputDuration(segment);
  }return spans;
}
function reorderSegment(segments,id,targetIndex){const index=segments.findIndex(c=>c.id===id);if(index<0)return segments;const next=[...segments],item=next.splice(index,1)[0];next.splice(clamp(targetIndex,0,next.length),0,item);return next;}
function snapTime(value,points,tolerance){let best=value,distance=tolerance;for(const point of points){const delta=Math.abs(point-value);if(Number.isFinite(point)&&delta<distance){best=point;distance=delta;}}return best;}
function restoreGap(segments,leftID,rightID){
  const left=segments.find(c=>c.id===leftID),right=segments.find(c=>c.id===rightID);if(!left||!right||right.sourceStart-left.sourceEnd<MIN_SEGMENT)return null;
  const start=left.sourceEnd,end=right.sourceStart;if(segments.some(c=>c.sourceStart<end&&c.sourceEnd>start))return null;
  const next=[...segments],index=next.findIndex(c=>c.id===leftID);next.splice(index+1,0,{id:uid(),sourceStart:start,sourceEnd:end,speed:1});return next;
}

const isRetained = (segments, sourceTime) =>
  segments.some((segment) => sourceTime >= segment.sourceStart && sourceTime <= segment.sourceEnd);

function splitAt(segments, outputTime) {
  const hit = locate(segments, outputTime);
  if (!hit) return null;
  const { index, segment, sourceTime } = hit;
  if (sourceTime - segment.sourceStart < MIN_SEGMENT || segment.sourceEnd - sourceTime < MIN_SEGMENT) return null;
  const next = segments.slice();
  next.splice(index, 1,
    { ...segment, sourceEnd: sourceTime },
    { ...segment, id: uid(), sourceStart: sourceTime,audio:segment.audio?{...segment.audio}:undefined });
  return next;
}

function removeSegment(segments, id) {
  if (segments.length <= 1) return null;
  const next = segments.filter((segment) => segment.id !== id);
  return next.length === segments.length ? null : next;
}

/// 拖动片段边缘裁短／恢复：不越过相邻片段，也不超出素材。
function trimSegment(segments, id, edge, sourceTime, mediaDuration) {
  const index = segments.findIndex((segment) => segment.id === id);
  if (index < 0) return null;
  const segment = segments[index];
  const next = segments.slice();
  if (edge === 'start') {
    const lower = Math.max(0,...segments.filter((s,i)=>i!==index&&s.sourceEnd<=segment.sourceStart+1e-9).map(s=>s.sourceEnd));
    next[index] = { ...segment, sourceStart: clamp(sourceTime, lower, segment.sourceEnd - MIN_SEGMENT) };
  } else {
    const upper = Math.min(mediaDuration,...segments.filter((s,i)=>i!==index&&s.sourceStart>=segment.sourceEnd-1e-9).map(s=>s.sourceStart));
    next[index] = { ...segment, sourceEnd: clamp(sourceTime, segment.sourceStart + MIN_SEGMENT, upper) };
  }
  return next;
}

function setSpeed(segments, id, speed) {
  return segments.map((segment) => (segment.id === id ? { ...segment, speed: clamp(speed, 0.25, 8) } : segment));
}

module.exports = {
  MIN_SEGMENT, SPEEDS,
  segmentOutputDuration, outputDuration, locate, sourceToOutput, isRetained,
  splitAt, removeSegment, trimSegment, setSpeed,
  retainedSpans,reorderSegment,restoreGap,
  snapTime,
};
