'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
function canonical(file){
  let value=path.resolve(file),tail=[];
  while(!fs.existsSync(value)){const parent=path.dirname(value);if(parent===value)break;tail.unshift(path.basename(value));value=parent;}
  value=path.join(fs.realpathSync(value),...tail);return process.platform==='win32'?value.toLowerCase():value;
}
function assetFiles(project,directory){
  const files=['project.json','project.json.bak','project.json.schema1.bak','project.json.schema2.bak','recording-session.json','pointer-events.ndjson'].map(name=>path.join(directory,name));
  const walk=(value,key)=>{if(typeof value==='string'&&['file','index','pointer','relativePath'].includes(key))files.push(path.resolve(directory,value));
    else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))walk(v,k);};
  walk(project.media,'media');walk(project.canvas.background,'background');
  for(const c of project.timeline.stickerClips||[])files.push(path.resolve(directory,c.relativePath));
  return files;
}
function beginExport(project,directory,outputFile){
  const target=canonical(outputFile);
  if(assetFiles(project,directory).some(file=>canonical(file)===target))throw new Error('导出位置会覆盖项目原始素材或工程，请选择其他文件。');
  const extension=path.extname(outputFile),temporary=path.join(path.dirname(outputFile),`.${path.basename(outputFile,extension)}.${randomUUID()}.export${extension}`);
  return{temporary,commit(){fs.renameSync(temporary,outputFile);},rollback(){fs.rmSync(temporary,{force:true});}};
}
module.exports={beginExport,assetFiles};
