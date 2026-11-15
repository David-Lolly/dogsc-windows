'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {planPaste}=require('../core/effect-clipboard'),{readProject}=require('./project-files');
class EffectAssets {
  constructor(){this.pending=new Map();}
  prepare(owner,payload,directory,project,sourceTime){
    planPaste(project,payload,sourceTime,directory,{allowForeignStickers:true});
    const copy=JSON.parse(JSON.stringify(payload));
    if(path.resolve(payload.sourceDirectory).toLowerCase()===path.resolve(directory).toLowerCase()||!copy.entries.some(e=>e.type==='sticker'))return{payload:copy,transferId:null};
    readProject(path.join(payload.sourceDirectory,'project.json'));readProject(path.join(directory,'project.json'));
    const source=fs.realpathSync(payload.sourceDirectory),destination=fs.realpathSync(directory),folder=path.join(destination,'media/stickers');fs.mkdirSync(folder,{recursive:true});
    if(!fs.realpathSync(folder).toLowerCase().startsWith(destination.toLowerCase()+path.sep))throw Error('目标素材目录不在工程内部。');
    const files=[],mapped=new Map();
    try{
      for(const entry of copy.entries){if(entry.type!=='sticker')continue;const file=fs.realpathSync(path.resolve(source,entry.clip.relativePath)),extension=path.extname(file).toLowerCase();
        if(!file.toLowerCase().startsWith(source.toLowerCase()+path.sep)||!['.png','.jpg','.jpeg','.webp','.bmp'].includes(extension))throw Error('贴图必须是源工程内的图片。');
        if(fs.statSync(file).size>128*1024*1024)throw Error('贴图超过 128MiB，请先缩小图片。');
        if(!mapped.has(file)){const relative=`media/stickers/${randomUUID()}${extension}`,target=path.join(destination,relative);fs.copyFileSync(file,target,fs.constants.COPYFILE_EXCL);files.push(target);mapped.set(file,relative);}entry.clip.relativePath=mapped.get(file);
      }
      copy.sourceDirectory=directory;
      const transferId=randomUUID(),cancel=()=>this.finish(owner.id,transferId,false);
      this.pending.set(transferId,{owner,files,destination,cancel});owner.once('destroyed',cancel);return{payload:copy,transferId};
    }catch(error){for(const file of files)fs.rmSync(file,{force:true});throw error;}
  }
  finish(ownerId,id,accepted){
    const task=this.pending.get(id);if(!task||task.owner.id!==ownerId)return false;
    this.pending.delete(id);task.owner.removeListener('destroyed',task.cancel);
    if(!accepted)for(const file of task.files)if(fs.existsSync(file)&&fs.realpathSync(file).toLowerCase().startsWith(task.destination.toLowerCase()+path.sep))fs.rmSync(file,{force:true});
    return true;
  }
}
module.exports={EffectAssets};
