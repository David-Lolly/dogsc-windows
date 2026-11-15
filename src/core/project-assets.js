'use strict';
const path=require('node:path');
function assetReferences(project){
  const items=[];
  for(const [key,label]of Object.entries({screen:'屏幕录像',camera:'摄像头',microphone:'麦克风',systemAudio:'系统声音'})){const ref=project.media[key];if(ref)items.push({key,label,file:ref.file,kind:['screen','camera'].includes(key)?'video':'audio',reference:ref});}
  const bg=project.canvas.background;if(['image','video'].includes(bg.kind))items.push({key:'background',label:'背景',file:bg.file,kind:bg.kind,reference:bg});
  for(const clip of project.timeline.stickerClips)items.push({key:`sticker:${clip.id}`,label:'贴图',file:clip.relativePath,kind:'image',reference:clip});
  return items;
}
function replaceAsset(project,directory,original,replacement,index){
  let changed=0;const absolute=path.resolve(directory,original).toLowerCase();
  for(const asset of assetReferences(project))if(path.resolve(directory,asset.file).toLowerCase()===absolute){
    if(asset.key.startsWith('sticker:'))asset.reference.relativePath=replacement;else asset.reference.file=replacement;
    if(asset.kind==='video')asset.reference.index=index;
    changed++;
  }
  return changed;
}
module.exports={assetReferences,replaceAsset};
