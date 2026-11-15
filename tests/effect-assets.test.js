'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {makeProject}=require('../src/core/model'),{makeSticker}=require('../src/core/overlays'),{copyEffects}=require('../src/core/effect-clipboard'),{writeProject}=require('../src/main/project-files'),{EffectAssets}=require('../src/main/effect-assets');
test('cross-project sticker paste owns its assets and cleans up only unaccepted transfers',()=>{
  const root=path.resolve(__dirname,'../../analysis/results');fs.mkdirSync(root,{recursive:true});const temp=fs.mkdtempSync(path.join(root,'effect-assets-'));
  try{
    const source=path.join(temp,'a'),target=path.join(temp,'b');fs.mkdirSync(source);fs.mkdirSync(target);
    const project=()=>makeProject({media:{screen:{file:'screen.mp4',width:640,height:360,duration:20}}}),a=project(),b=project();
    a.timeline.stickerClips=[makeSticker('sticker.png',1,2)];fs.writeFileSync(path.join(source,'sticker.png'),'owned image');writeProject(source,a);writeProject(target,b);
    const payload=copyEffects(a,{type:'sticker',id:a.timeline.stickerClips[0].id},source),owner=Object.assign(new EventEmitter(),{id:1}),service=new EffectAssets();
    const pending=service.prepare(owner,payload,target,b,8),file=path.join(target,pending.payload.entries[0].clip.relativePath);assert.equal(fs.readFileSync(file,'utf8'),'owned image');
    assert.equal(service.finish(2,pending.transferId,false),false);assert.ok(fs.existsSync(file));owner.emit('destroyed');assert.equal(fs.existsSync(file),false);
    const accepted=service.prepare(owner,payload,target,b,8),copy=path.join(target,accepted.payload.entries[0].clip.relativePath);assert.ok(service.finish(owner.id,accepted.transferId,true));
    fs.rmSync(path.join(source,'sticker.png'));assert.equal(fs.readFileSync(copy,'utf8'),'owned image');assert.equal(service.pending.size,0);assert.equal(owner.listenerCount('destroyed'),0);
    assert.equal(accepted.payload.sourceDirectory,target);
  }finally{assert.ok(path.resolve(temp).startsWith(root+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
