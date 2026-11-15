'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {validateProjectContract}=require('../core/model');

function atomicWrite(file,data){
  const temporary=`${file}.${randomUUID()}.tmp`;
  let fd;
  try{fd=fs.openSync(temporary,'wx');fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temporary,file);}
  finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
function readProject(file){const project=JSON.parse(fs.readFileSync(file,'utf8'));validateProjectContract(project);return project;}
function writeProject(directory,project){
  validateProjectContract(project);
  const file=path.join(directory,'project.json');
  if(fs.existsSync(file)){
    let current;
    try{current=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    if(current&&(current.app!=='dogsc-windows'||current.schema>3))throw new Error('拒绝覆盖外来或未来版本工程。');
    // Never overwrite a damaged or future-format project with a new default.
    readProject(file);
    if(current.schema===2&&project.schema===3&&!fs.existsSync(`${file}.schema2.bak`))fs.copyFileSync(file,`${file}.schema2.bak`,fs.constants.COPYFILE_EXCL);
    atomicWrite(`${file}.bak`,fs.readFileSync(file));
  }
  atomicWrite(file,JSON.stringify(project,null,2));
}
function restoreProjectBackup(directory){
  const file=path.join(directory,'project.json'),backup=`${file}.bak`;
  const project=readProject(backup);
  if(fs.existsSync(file)){
    let current;try{current=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    if(current&&(current.app!=='dogsc-windows'||current.schema>3))throw new Error('拒绝用备份覆盖外来或未来版本工程。');
    try{readProject(file);throw Object.assign(new Error('工程文件正常，无需覆盖恢复。'),{validProject:true});}
    catch(error){if(error.validProject)throw error;}
    fs.copyFileSync(file,`${file}.damaged-${randomUUID()}.bak`,fs.constants.COPYFILE_EXCL);
  }
  atomicWrite(file,JSON.stringify(project,null,2));return project;
}
module.exports={atomicWrite,readProject,writeProject,restoreProjectBackup};
