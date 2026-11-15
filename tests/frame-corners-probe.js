'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Compositor}=require('../src/renderer/editor/render');
const {decorationInsets,decorationGeometry}=require('../src/core/screen-decoration');
exports.run=async directory=>{
  const results=[];
  for(const style of ['browserLight','windowLight','browserDark','devicePhone'])for(const scale of [0.5,1,2]){
    const canvas=new OffscreenCanvas(640*scale,360*scale),ctx=canvas.getContext('2d'),compositor=new Compositor(directory);
    const source=new OffscreenCanvas(400,220);source.getContext('2d').fillStyle='#51b88a';source.getContext('2d').fillRect(0,0,400,220);
    const screen={finalRect:{x:100*scale,y:100*scale,width:400*scale,height:220*scale},cornerRadius:18*scale,borderWidth:0,crop:{x:0,y:0,width:1,height:1},decoration:{...decorationInsets({screenFrame:style},scale),style,scale,title:'Window',address:'example.com'},shadow:{opacity:0.28,radius:22*scale,offsetY:12*scale}};
    const geometry=decorationGeometry(screen),r=geometry.rect,pad=(geometry.radius+screen.cornerRadius)/2*(1-Math.SQRT1_2);
    const left=Math.floor(r.x+pad-0.5),top=Math.floor(r.y+pad-0.5),right=Math.ceil(r.x+r.width-pad-0.5),bottom=Math.ceil(r.y+r.height-pad-0.5);
    const points=[[left,top],[right,top],[left,bottom],[right,bottom]];
    const draw=()=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);compositor.drawScreen(ctx,screen,source);return points.map(([x,y])=>ctx.getImageData(x,y,1,1).data[0]);};
    const original=compositor.drawShadow.bind(compositor);
    compositor.drawShadow=(context,rect,radius,shadow)=>{context.save();context.shadowColor=`rgba(0,0,0,${shadow.opacity})`;context.shadowBlur=shadow.radius*2;context.shadowOffsetY=shadow.offsetY;context.fillStyle='#000';context.beginPath();context.roundRect(rect.x,rect.y,rect.width,rect.height,screen.cornerRadius);context.fill();context.restore();};
    const before=draw();
    compositor.drawShadow=original;const after=draw();
    assert.ok(before.some((value,i)=>after[i]-value>20),`${style}/${scale}: regression fixture must expose caster, before=${before}, after=${after}`);
    assert.ok(after.every(value=>value>120),`${style}/${scale}: corner leaked black caster ${after}`);
    assert.ok(ctx.getImageData(Math.round(r.x+r.width/2),Math.round(r.y+r.height+5*scale),1,1).data[0]<250,'natural drop shadow must remain');
    if(style==='browserLight'&&scale===1)fs.writeFileSync(path.join(directory,'frame-corners-fixed.png'),Buffer.from(await(await canvas.convertToBlob()).arrayBuffer()));
    results.push({style,scale,before,after});compositor.dispose();
  }
  const shadowCanvas=new OffscreenCanvas(320,240),shadowContext=shadowCanvas.getContext('2d'),shadowCompositor=new Compositor(directory);
  shadowContext.translate(160,110);shadowContext.rotate(Math.PI/5);shadowContext.scale(0.7,0.9);
  shadowCompositor.drawShadow(shadowContext,{x:-60,y:-35,width:120,height:70},12,{opacity:0.5,radius:8,offsetX:4,offsetY:10});
  const pixels=shadowContext.getImageData(0,0,320,240).data;let maximumAlpha=0;for(let i=3;i<pixels.length;i+=4)maximumAlpha=Math.max(maximumAlpha,pixels[i]);
  assert.ok(maximumAlpha>10&&maximumAlpha<=129,`transformed shadow contains opaque caster or is missing: ${maximumAlpha}`);shadowCompositor.dispose();
  const custom=new OffscreenCanvas(640,360),customContext=custom.getContext('2d'),customCompositor=new Compositor(directory),image=new OffscreenCanvas(400,220);image.getContext('2d').fillStyle='#51b88a';image.getContext('2d').fillRect(0,0,400,220);customContext.fillStyle='#fff';customContext.fillRect(0,0,640,360);
  customCompositor.drawScreen(customContext,{finalRect:{x:100,y:100,width:400,height:220},cornerRadius:0,borderWidth:0,crop:{x:0,y:0,width:1,height:1},decoration:{...decorationInsets({screenFrame:'browserLight'}),style:'browserLight',scale:1,outerCornerRadius:80,insetOpacity:0.4,title:'Custom',address:'example.com'}},image);
  assert.ok(customContext.getImageData(101,319,1,1).data[0]>200,'content must not poke out of the authored outer corner');assert.equal(customContext.getImageData(300,200,1,1).data[0],81,'frame opacity must not change the source pixels');customCompositor.dispose();
  const report={passed:true,styles:4,scales:3,fourCornersChecked:true,customOuterClipping:true,insetOpacityKeepsContent:true,shadowOnlyTransformed:true,maximumShadowAlpha:maximumAlpha,samples:results,scope:'Shared preview/export screen drawing; opaque black shadow-caster wedges excluded, natural soft shadow retained.'};
  fs.writeFileSync(path.join(directory,'frame-corners-report.json'),JSON.stringify(report,null,2));return report;
};
