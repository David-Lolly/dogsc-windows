'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {makeProject}=require('../src/core/model');
const {evaluateScene}=require('../src/core/scene');
const {defaultFocus}=require('../src/core/focus-effect');
const {Compositor}=require('../src/renderer/editor/render');
const {Preview}=require('../src/renderer/editor/preview');
const {exportProject}=require('../src/renderer/editor/export');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const timing=(start,duration,lead,back)=>({startTime:start,duration,leadInDuration:lead,returnDuration:back,easing:'linear'});

exports.run=async(output)=>{
  const p=makeProject({name:'effects-pixel-probe',media:{screen:{file:'pattern.mp4',width:640,height:360,duration:3,frameRate:30},
    camera:{file:'red-camera.mp4',width:320,height:240,duration:3,offset:0}}});
  Object.assign(p.canvas,{padding:0,cornerRadius:0,borderWidth:0,shadowStrength:0,background:{kind:'color',color:'#123456'}});
  const checker=new OffscreenCanvas(640,360),checkCtx=checker.getContext('2d');
  for (let y=0;y<360;y+=8) for(let x=0;x<640;x+=8){checkCtx.fillStyle=((x+y)/8)%2===0?'white':'black';checkCtx.fillRect(x,y,8,8);}
  const canvas=new OffscreenCanvas(640,360),ctx=canvas.getContext('2d'),compositor=new Compositor(output);
  const clip={id:'focus-probe',timing:timing(0,2.5,0,0.5),target:{position:{x:0.5,y:0.5},scale:1,rotationX:0,rotationY:0,rotationZ:0,perspective:0.65}};
  p.timeline.screenMotionClips=[clip];
  const draw=()=>{const scene=evaluateScene(p,{time:1,width:640,height:360,sourceAspect:16/9,cameraAspect:null,zoomClips:[],pointerTrack:null});compositor.draw(ctx,p,scene,{screen:checker,camera:null});return scene;};
  draw();const white=[...ctx.getImageData(322,182,1,1).data];assert.ok(white[0]>250);
  clip.focusEffect={...defaultFocus(),target:'fixed',blur:1,dimming:0.5,size:0.4};
  draw();const sharp=[...ctx.getImageData(322,182,1,1).data],defocused=[...ctx.getImageData(18,18,1,1).data];
  assert.ok(sharp[0]>250,'radial focus must retain untouched source pixels');
  assert.ok(defocused[0]>20&&defocused[0]<120,'outside radial focus must blur and dim checkerboard');
  clip.focusEffect.shape='linear';clip.focusEffect.size=0.2;
  draw();assert.ok(ctx.getImageData(18,182,1,1).data[0]>250,'horizontal strip must stay sharp');
  assert.ok(ctx.getImageData(322,18,1,1).data[0]<120,'outside horizontal strip must be defocused');
  clip.focusEffect.angleDegrees=90;
  draw();assert.ok(ctx.getImageData(322,18,1,1).data[0]>250,'rotated strip must stay sharp');
  assert.ok(ctx.getImageData(18,182,1,1).data[0]<120,'outside rotated strip must be defocused');
  clip.target.rotationY=30;clip.focusEffect=null;draw();
  const projectedBase=[...ctx.getImageData(322,182,1,1).data];
  clip.focusEffect={...defaultFocus(),target:'fixed',blur:1,dimming:0.5};draw();
  const projectedSharp=[...ctx.getImageData(322,182,1,1).data];
  assert.ok(projectedBase.every((v,i)=>Math.abs(v-projectedSharp[i])<2),'3D projection must carry the clear mask with the source');
  fs.writeFileSync(path.join(output,'focus-effects.png'),Buffer.from(canvas.convertToBlob ? await (await canvas.convertToBlob()).arrayBuffer() : []));
  // Compare actual GPU pixels before/after preserving animation phase.
  clip.timing.leadInDuration=1.5;
  const sliced=require('../src/core/effect-slices').splitEffects(p,[{type:'screenMotion',id:clip.id}],0.8,output).project;
  let splitMaxPixelDifference=0;
  for(const time of [0,0.4,0.799,0.8,0.801,1.2,2.49,2.5,2.7,2.99]){
    const sample=project=>{const scene=evaluateScene(project,{time,width:640,height:360,sourceAspect:16/9,cameraAspect:null,zoomClips:[],pointerTrack:null});compositor.draw(ctx,project,scene,{screen:checker,camera:null});return ctx.getImageData(0,0,640,360).data;};
    const before=sample(p),after=sample(sliced);for(let n=0;n<before.length;n++)splitMaxPixelDifference=Math.max(splitMaxPixelDifference,Math.abs(before[n]-after[n]));
  }
  assert.ok(splitMaxPixelDifference<=1,'split GPU continuity');
  compositor.dispose();

  Object.assign(p.canvas,{padding:40,cornerRadius:20,shadowStrength:0.2});
  clip.target.rotationX=12;clip.target.rotationZ=5;
  p.timeline.cameraMotionClips=[
    {id:'camera-shape',timing:timing(0.4,0.9,0.3,0),target:{layout:{kind:'shape',shape:'circle'},position:{x:0.8,y:0.7},size:0.4,roundness:1,opacity:0.8}},
    {id:'camera-full',timing:timing(1.3,0.8,0.3,0.5),target:{layout:{kind:'fullscreen'},position:{x:0.5,y:0.5},size:0.4,roundness:0,opacity:1}},
  ];
  Object.assign(p.openingSequence,{isEnabled:true,preset:'light3D',duration:1.2,stagger:0.15});
  const wrap=document.createElement('div');wrap.style.cssText='width:640px;height:360px';
  const previewCanvas=document.createElement('canvas');wrap.append(previewCanvas);document.body.append(wrap);
  const store={project:p,directory:output,zoomClips:[],pointerTrack:null,subscribe:()=>{}};
  const preview=new Preview(store,previewCanvas,wrap);
  const settle=async()=>{
    const end=performance.now()+10000;
    while([preview.screen,preview.camera].some(t=>t.node.readyState<2||t.node.seeking||t.pendingTime!=null)){
      if(performance.now()>end)throw new Error('effect preview video timeout');await sleep(10);
    }
  };
  const sampleFrames=[0,9,27,51,81],references=new Map();
  for (const n of sampleFrames){preview.seek(n/30);await settle();previewCanvas.width=640;previewCanvas.height=360;preview.draw();references.set(n,preview.ctx.getImageData(0,0,640,360).data);}
  const errors=[];
  const exported=await exportProject({project:p,directory:output,outputFile:path.join(output,'combined-effects.mp4'),resolution:'source',frameRate:30,
    frameHook:(n,target)=>{
      if(!references.has(n))return;
      const pixels=target.getContext('2d').getImageData(0,0,640,360).data,reference=references.get(n);
      let total=0;for(let i=0;i<pixels.length;i++)total+=Math.abs(pixels[i]-reference[i]);
      const mean=total/pixels.length;errors.push({frame:n,time:n/30,meanPixelDifferenceBeforeEncoding:mean});
      assert.ok(mean<3,`combined preview/export mismatch at frame ${n}: ${mean}; preview=${[...reference.slice((180*640+320)*4,(180*640+320)*4+4)]}; export=${[...pixels.slice((180*640+320)*4,(180*640+320)*4+4)]}`);
    }});
  preview.compositor.dispose();
  assert.equal(errors.length,sampleFrames.length);assert.equal(exported.frames,90);
  const hdProject=JSON.parse(JSON.stringify(p));
  hdProject.canvas.aspectRatio='landscape';
  hdProject.timeline.segments=[{id:'hd-segment',sourceStart:0.5,sourceEnd:1.5,speed:1}];
  const hd=await exportProject({project:hdProject,directory:output,outputFile:path.join(output,'combined-effects-1080p60.mp4'),
    resolution:'fullHD',frameRate:60});
  assert.equal(hd.width,1920);assert.equal(hd.height,1080);assert.equal(hd.frames,60);
  const report={passed:true,animationSplit:{passed:true,maxPixelDifference:splitMaxPixelDifference,samples:10},radialFocus:{sharp,defocused},linearFocus:true,projectedFocus:{projectedBase,projectedSharp},
    combinedExport:{passed:true,frames:exported.frames,duration:exported.duration,encoder:exported.encoder,samples:errors},
    fullHD60Export:{passed:true,width:hd.width,height:hd.height,frames:hd.frames,duration:hd.duration,encoder:hd.encoder},
    scope:'Synthetic Windows media only; does not establish Mac parity or hardware/device stability.'};
  fs.writeFileSync(path.join(output,'effects-report.json'),JSON.stringify(report,null,2));
  return report;
};
