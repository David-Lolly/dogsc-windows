'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const KEYS=['canvas','camera','cursorStyle','motion','openingSequence'];
class ScenePresets{
  constructor(directory){this.directory=directory;this.file=path.join(directory,'presets.json');}
  read(){if(!fs.existsSync(this.file))return[];const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.version!==1||!Array.isArray(data.presets))throw new Error('场景预设格式不兼容。');return data.presets;}
  list(){return [...require('../core/scene-presets').builtinPresets(),...this.read()];}
  write(presets){fs.mkdirSync(this.directory,{recursive:true});fs.writeFileSync(`${this.file}.tmp`,JSON.stringify({version:1,presets},null,2));fs.renameSync(`${this.file}.tmp`,this.file);}
  save(name,project,projectDirectory){
    const id=randomUUID(),style=JSON.parse(JSON.stringify(Object.fromEntries(KEYS.map(key=>[key,project[key]]))));
    const bg=style.canvas.background;
    if(['image','video'].includes(bg.kind)){
      const original=path.resolve(projectDirectory,bg.file),relative=`assets/${id}${path.extname(original)}`;fs.mkdirSync(path.join(this.directory,'assets'),{recursive:true});fs.copyFileSync(original,path.join(this.directory,relative));bg.file=relative;
      if(bg.kind==='video')delete bg.index;
    }
    const presets=this.read();presets.push({id,name:String(name).trim().slice(0,100)||'未命名场景',style});this.write(presets);return id;
  }
  apply(id,projectDirectory){
    const preset=this.list().find(p=>p.id===id);if(!preset)throw new Error('场景预设不存在。');
    const style=JSON.parse(JSON.stringify(preset.style)),bg=style.canvas.background;
    if(['image','video'].includes(bg.kind)){
      const original=path.resolve(this.directory,bg.file),assets=path.resolve(this.directory,'assets')+path.sep;if(!original.startsWith(assets))throw new Error('预设资产路径无效。');
      const relative=`media/backgrounds/${randomUUID()}${path.extname(original)}`;fs.mkdirSync(path.join(projectDirectory,'media/backgrounds'),{recursive:true});fs.copyFileSync(original,path.join(projectDirectory,relative));bg.file=relative;delete bg.index;
    }return style;
  }
  remove(id){if(id.startsWith('builtin:'))throw new Error('内置预设不能删除。');this.write(this.read().filter(p=>p.id!==id));}
}
module.exports={ScenePresets};
