'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {makeProject}=require('../src/core/model'),{makeSticker,makeMosaic}=require('../src/core/overlays');
const {evaluateScene}=require('../src/core/scene');
const {Compositor}=require('../src/renderer/editor/render'),{Preview}=require('../src/renderer/editor/preview'),{exportProject}=require('../src/renderer/editor/export');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async(output)=>{
  const stickerCanvas=new OffscreenCanvas(64,64),stickerContext=stickerCanvas.getContext('2d');
  for(const [file,color]of[['green.png','#00ff00'],['blue.png','#0000ff']]){stickerContext.fillStyle=color;stickerContext.fillRect(0,0,64,64);fs.writeFileSync(path.join(output,file),Buffer.from(await(await stickerCanvas.convertToBlob()).arrayBuffer()));}
  const p=makeProject({name:'overlay-render-probe',media:{screen:{file:'pattern.mp4',width:640,height:360,duration:3,frameRate:30}}});
  Object.assign(p.canvas,{padding:0,cornerRadius:0,shadowStrength:0});
  const checker=new OffscreenCanvas(640,360),source=checker.getContext('2d');
  for(let y=0;y<360;y+=8)for(let x=0;x<640;x+=8){source.fillStyle=((x+y)/8)%2===0?'white':'black';source.fillRect(x,y,8,8);}
  const canvas=new OffscreenCanvas(640,360),ctx=canvas.getContext('2d'),compositor=new Compositor(output);
  const draw=()=>{const scene=evaluateScene(p,{time:1,width:640,height:360,sourceAspect:16/9,cameraAspect:null,zoomClips:[],pointerTrack:null});compositor.draw(ctx,p,scene,{screen:checker,camera:null});};
  const blur=makeMosaic(0,3);blur.intensity=1;p.timeline.mosaicClips=[blur];draw();
  const softened=ctx.getImageData(322,182,1,1).data[0];assert.ok(softened>60&&softened<200,'redaction must remove checkerboard detail');
  const spotlight=makeMosaic(0,3,'spotlight');spotlight.spotlightDimming=0.6;spotlight.intensity=1;p.timeline.mosaicClips=[spotlight];draw();
  assert.ok(ctx.getImageData(322,182,1,1).data[0]>250,'spotlight interior must stay clear');assert.ok(ctx.getImageData(18,18,1,1).data[0]<100,'spotlight exterior must dim');
  p.timeline.mosaicClips=[];
  const green=makeSticker('green.png',0,3,0);Object.assign(green,{animation:'none',exitAnimation:'none',backdropBlur:0,shadowOpacity:0,width:0.25});p.timeline.stickerClips=[green];await compositor.prepare(p);draw();
  assert.deepEqual([...ctx.getImageData(320,180,1,1).data],[0,255,0,255]);
  const blue={...green,id:'top-blue',relativePath:'blue.png',layerIndex:1};p.timeline.stickerClips=[blue,green];await compositor.prepare(p);draw();
  assert.deepEqual([...ctx.getImageData(320,180,1,1).data],[0,0,255,255]);
  const dynamic=[];for(const preset of ['cyberDriftGrid','starfieldDots','auroraFluid']){
    p.canvas.background={kind:'dynamic',preset};const a=Buffer.from(compositor.backgroundLayer(p.canvas,640,360,1/3,0).getContext('2d').getImageData(0,0,640,360).data);
    const b=Buffer.from(compositor.backgroundLayer(p.canvas,640,360,1/3,2).getContext('2d').getImageData(0,0,640,360).data);assert.notEqual(Buffer.compare(a,b),0,`${preset} must change with time`);dynamic.push(preset);
  }
  compositor.dispose();
  const bad=JSON.parse(JSON.stringify(p));bad.timeline.stickerClips[0].relativePath='missing.png';
  const target=path.join(output,'preserve-output.mp4');fs.writeFileSync(target,'existing output');
  await assert.rejects(()=>exportProject({project:bad,directory:output,outputFile:target,resolution:'source',frameRate:30}),/无法读取/);
  assert.equal(fs.readFileSync(target,'utf8'),'existing output');
  Object.assign(p.canvas,{padding:45,screenFrame:'browserDark',screenFrameTitle:'验收',screenFrameBrowserAddress:'https://example.com',background:{kind:'video',file:'loop-background.mp4',width:320,height:180,duration:1}});
  p.timeline.stickerClips=[green];green.position={x:0.8,y:0.2};green.animation='pop';green.enterDuration=0.4;green.exitDuration=0.3;
  p.timeline.mosaicClips=[blur,spotlight];blur.sourceRect={x:0.1,y:0.2,width:0.3,height:0.3};
  Object.assign(p.openingSequence,{isEnabled:true,preset:'sideSlide',duration:0.6,stagger:0.1});
  const wrap=document.createElement('div');wrap.style.cssText='width:640px;height:360px';const previewCanvas=document.createElement('canvas');wrap.append(previewCanvas);document.body.append(wrap);
  const preview=new Preview({directory:output,project:p,zoomClips:[],pointerTrack:null,subscribe:()=>{}},previewCanvas,wrap);
  const settle=async()=>{const deadline=performance.now()+10000;while([preview.screen,preview.background].some(t=>t.node.readyState<2||t.node.seeking||t.pendingTime!=null)){if(performance.now()>deadline)throw new Error('overlay media timeout');await sleep(10);}};
  await preview.compositor.prepare(p);
  const refs=new Map();for(const n of [15,45,81]){preview.seek(n/30);await settle();previewCanvas.width=640;previewCanvas.height=360;preview.draw();refs.set(n,preview.ctx.getImageData(0,0,640,360).data);}
  const differences=[];
  const video=await exportProject({project:p,directory:output,outputFile:path.join(output,'overlay-effects.mp4'),resolution:'source',frameRate:30,frameHook:(n,c)=>{
    if(!refs.has(n))return;const a=c.getContext('2d').getImageData(0,0,640,360).data,b=refs.get(n);let total=0;for(let i=0;i<a.length;i++)total+=Math.abs(a[i]-b[i]);const mean=total/a.length;differences.push({frame:n,mean});assert.ok(mean<3,`overlay preview/export mismatch ${n}: ${mean}`);
  }});
  preview.compositor.dispose();assert.equal(video.frames,90);
  const report={passed:true,softenedPixel:softened,spotlight:true,stickerPixelsAndLayering:true,dynamicBackgrounds:dynamic,failedExportPreservedDestination:true,
    videoBackgroundAndFrameExport:{frames:video.frames,duration:video.duration,samples:differences},scope:'Windows synthetic fixtures; Mac comparison and complete frame geometry parity pending.'};
  fs.writeFileSync(path.join(output,'overlay-report.json'),JSON.stringify(report,null,2));return report;
};
