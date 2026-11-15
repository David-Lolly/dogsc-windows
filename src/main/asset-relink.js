'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {assetReferences,replaceAsset}=require('../core/project-assets'),{validateProjectContract}=require('../core/model');
async function relinkAsset(directory,project,key,replacement,media){
  validateProjectContract(project);
  const asset=assetReferences(project).find(a=>a.key===key);if(!asset)throw Error('这个素材已不存在，请刷新列表。');
  const info=await media.probe(replacement);
  if(asset.kind==='video'){
    if(!info.video||info.video.codec!=='h264')throw Error('请定位 H.264 视频素材，以保留现有逐帧编辑。');
    if(info.duration+0.04<(asset.reference.duration||0))throw Error('所选视频比原素材短，会丢失已有剪辑。');
    if(asset.reference.width&&asset.reference.height&&(info.video.width!==asset.reference.width||info.video.height!==asset.reference.height))throw Error('所选视频的尺寸与原素材不一致。');
  }else if(asset.kind==='audio'){
    if(!info.hasAudio)throw Error('所选文件没有音轨。');if(info.duration+0.1<(asset.reference.duration||0))throw Error('所选音频比原素材短。');
  }else if(!info.video||!['.png','.jpg','.jpeg','.webp','.bmp'].includes(path.extname(replacement).toLowerCase()))throw Error('请选择有效的 PNG/JPG/WebP/BMP 图片。');
  const root=fs.realpathSync(directory),folder=path.join(root,'media/relinked');fs.mkdirSync(folder,{recursive:true});
  if(!fs.realpathSync(folder).toLowerCase().startsWith(root.toLowerCase()+path.sep))throw Error('素材目录不在工程内部。');
  const extension=asset.kind==='video'?'.mp4':asset.kind==='audio'?'.m4a':path.extname(replacement).toLowerCase(),relative=`media/relinked/${randomUUID()}${extension}`,target=path.join(root,relative),index=asset.kind==='video'?`${relative}.index.json`:null;
  try{
    if(asset.kind==='video'){await media.remuxToMp4(replacement,target);fs.writeFileSync(path.join(root,index),JSON.stringify(await media.buildVideoIndex(target)));}
    else if(asset.kind==='audio')await media.finalizeAudio(replacement,target);
    else fs.copyFileSync(replacement,target,fs.constants.COPYFILE_EXCL);
    const check=JSON.parse(JSON.stringify(project));replaceAsset(check,directory,asset.file,relative,index);validateProjectContract(check);
    return{original:asset.file,replacement:relative,index};
  }catch(error){fs.rmSync(target,{force:true});if(index)fs.rmSync(path.join(root,index),{force:true});throw error;}
}
module.exports={relinkAsset};
