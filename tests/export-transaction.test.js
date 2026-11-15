'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {makeProject}=require('../src/core/model');
const {beginExport}=require('../src/core/export-transaction');
test('muted, hidden and external assets are protected; failed export preserves destination',()=>{
  const root=path.resolve(__dirname,'../../analysis/results');fs.mkdirSync(root,{recursive:true});
  const dir=fs.mkdtempSync(path.join(root,'dogsc-export-'));
  try{const source=path.join(dir,'source.mp4'),mic=path.join(dir,'muted.m4a'),bg=path.join(dir,'background.png'),target=path.join(dir,'output.mp4');
    for(const file of [source,mic,bg,target])fs.writeFileSync(file,'original');
    const p=makeProject({name:'tx',media:{screen:{file:'source.mp4',width:640,height:360,duration:3},microphone:{file:'muted.m4a',duration:3}}});p.audio.isMicrophoneMuted=true;p.canvas.background={kind:'image',file:bg};
    for(const file of [source,mic,bg,path.join(dir,'project.json'),path.join(dir,'project.json.schema2.bak'),path.join(dir,'pointer-events.ndjson')])assert.throws(()=>beginExport(p,dir,file),/覆盖/);
    const failed=beginExport(p,dir,target);fs.writeFileSync(failed.temporary,'partial');failed.rollback();assert.equal(fs.readFileSync(target,'utf8'),'original');
    const success=beginExport(p,dir,target);fs.writeFileSync(success.temporary,'complete');success.commit();success.rollback();assert.equal(fs.readFileSync(target,'utf8'),'complete');
  }finally{assert.ok(path.resolve(dir).startsWith(root+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
