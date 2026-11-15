'use strict';
const path=require('node:path');
const {projectScreen,mapPlanePoint}=require('../../core/screen-projection');
const clamp=(n,a,b)=>Math.min(Math.max(n,a),b);
const ns='http://www.w3.org/2000/svg';
const node=(name,attrs)=>{const n=document.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
class CanvasInteraction{
  constructor(store,preview){
    this.store=store;this.preview=preview;this.svg=node('svg',{'aria-label':'画布编辑控件'});this.svg.classList.add('canvas-tools');preview.wrap.append(this.svg);
    preview.onDraw=()=>this.render();store.subscribe(()=>this.render());
  }
  selected(){const selection=this.store.selection;if(!selection)return null;const kind=selection.type;
    const pool=kind==='zoom'?this.store.project.zoomAnimations:this.store.project.timeline[`${kind}Clips`];return pool?.find(c=>c.id===selection.id)||null;}
  render(){
    const scene=this.preview.scene,clip=this.selected();this.svg.replaceChildren();if(!scene||!clip||clip.animationSlice)return;
    const bounds=this.preview.canvas.getBoundingClientRect(),wrap=this.preview.wrap.getBoundingClientRect();
    Object.assign(this.svg.style,{left:`${bounds.left-wrap.left}px`,top:`${bounds.top-wrap.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});this.svg.setAttribute('viewBox',`0 0 ${scene.width} ${scene.height}`);
    const kind=this.store.selection.type,rect=scene.screen.finalRect,quad=scene.screen.quad||projectScreen(rect),point=(u,v)=>mapPlanePoint(quad,rect,{x:rect.x+u*rect.width,y:rect.y+v*rect.height});
    let points;
    if(kind==='mosaic'){
      const c=scene.screen.crop,r=clip.sourceRect,x=(r.x-c.x)/c.width,y=(r.y-c.y)/c.height,w=r.width/c.width,h=r.height/c.height;points=[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)];
    }else if(kind==='sticker'){
      const image=this.preview.compositor.images.get(path.resolve(this.store.directory,clip.relativePath)),w=clip.width*scene.width,h=w*(image?image.naturalHeight/image.naturalWidth:1);
      points=projectScreen({x:clip.position.x*scene.width-w/2,y:clip.position.y*scene.height-h/2,width:w,height:h},{rotationZ:clip.rotationDegrees,perspective:0});
    }else if(kind==='cameraMotion'&&scene.camera&&clip.target.layout.kind!=='fullscreen'){
      points=projectScreen(scene.camera.rect,{},undefined);
    }else if(kind==='screenMotion'||kind==='zoom')points=quad;
    if(points?.every(Boolean))this.outline(points,kind==='mosaic'?'#f3a74f':'#70b6ff',e=>this.start(e,'move',clip,kind,scene),e=>this.start(e,'resize',clip,kind,scene));
    if((kind==='screenMotion'||kind==='zoom')&&clip.focusEffect){
      const f=clip.focusEffect,c=scene.screen.crop,center=f.target==='fixed'?{x:(f.center.x-c.x)/c.width,y:(f.center.y-c.y)/c.height}:scene.screen.focusEffect?.center||{x:0.5,y:0.5};
      const cx=rect.x+center.x*rect.width,cy=rect.y+center.y*rect.height,r=Math.min(rect.width,rect.height)*f.size/2,angle=(f.angleDegrees||0)*Math.PI/180;
      const source=f.shape==='linear'?[[-rect.width,-r],[rect.width,-r],[rect.width,r],[-rect.width,r]].map(([x,y])=>({x:cx+x*Math.cos(angle)-y*Math.sin(angle),y:cy+x*Math.sin(angle)+y*Math.cos(angle)})):
        Array.from({length:48},(_,i)=>({x:cx+Math.cos(i*Math.PI/24)*r,y:cy+Math.sin(i*Math.PI/24)*r}));
      const guide=source.map(p=>mapPlanePoint(quad,rect,p));if(guide.every(Boolean))this.outline(guide,'#c5e99b',e=>this.start(e,'focus',clip,kind,scene),e=>this.start(e,'focusSize',clip,kind,scene),true);
    }
  }
  outline(points,color,move,resize,dashed=false){
    const polygon=node('polygon',{points:points.map(p=>`${p.x},${p.y}`).join(' '),fill:'transparent',stroke:color,'stroke-width':1.5,'vector-effect':'non-scaling-stroke','pointer-events':dashed?'stroke':'all',cursor:'move',...(dashed?{'stroke-dasharray':'6 4'}:{})});polygon.addEventListener('pointerdown',move);this.svg.append(polygon);
    const p=points.length>4?points[0]:points[2],handle=node('circle',{cx:p.x,cy:p.y,r:6,fill:color,stroke:'#fff','stroke-width':1,'vector-effect':'non-scaling-stroke','pointer-events':'all',cursor:'nwse-resize'});handle.addEventListener('pointerdown',resize);this.svg.append(handle);
  }
  start(event,mode,clip,kind,scene){
    event.preventDefault();event.stopPropagation();const before=JSON.parse(JSON.stringify(clip)),bounds=this.preview.canvas.getBoundingClientRect(),screen=scene.screen,rect=screen.finalRect,quad=screen.quad||projectScreen(rect),crop=screen.crop;
    const canvasPoint=e=>({x:(e.clientX-bounds.left)/bounds.width*scene.width,y:(e.clientY-bounds.top)/bounds.height*scene.height});
    const sourcePoint=e=>{const p=mapPlanePoint(quad,rect,canvasPoint(e),true);return p?{x:(p.x-rect.x)/rect.width,y:(p.y-rect.y)/rect.height}:null;};
    const initial=canvasPoint(event),initialSource=sourcePoint(event);if(!initialSource)return;
    this.store.beginGesture();
    const move=e=>{const now=canvasPoint(e),local=sourcePoint(e);if(!local)return;const dx=now.x-initial.x,dy=now.y-initial.y;
      this.store.mutate(()=>{
        if(mode==='focus'){clip.focusEffect.target='fixed';clip.focusEffect.center={x:clamp(crop.x+local.x*crop.width,0,1),y:clamp(crop.y+local.y*crop.height,0,1)};return;}
        if(mode==='focusSize'){clip.focusEffect.size=clamp(before.focusEffect.size+Math.hypot(dx,dy)/Math.min(rect.width,rect.height)*(dx+dy>=0?2:-2),0.1,1);return;}
        if(kind==='mosaic'){const r=clip.sourceRect,a=before.sourceRect,sx=(local.x-initialSource.x)*crop.width,sy=(local.y-initialSource.y)*crop.height;
          if(mode==='resize'){r.width=clamp(a.width+sx,0.01,1-a.x);r.height=clamp(a.height+sy,0.01,1-a.y);}else{r.x=clamp(a.x+sx,0,1-r.width);r.y=clamp(a.y+sy,0,1-r.height);}return;}
        if(kind==='sticker'){if(mode==='resize'){const angle=before.rotationDegrees*Math.PI/180;clip.width=clamp(before.width+2*(dx*Math.cos(angle)+dy*Math.sin(angle))/scene.width,0.02,2);}else clip.position={x:clamp(before.position.x+dx/scene.width,0,1),y:clamp(before.position.y+dy/scene.height,0,1)};return;}
        if(kind==='cameraMotion'){const c=scene.camera;if(mode==='resize')clip.target.size=clamp(before.target.size+dy/scene.height*2,0.1,1.2);else clip.target.position={x:clamp(before.target.position.x+dx/Math.max(1,scene.width-c.rect.width),0,1),y:clamp(before.target.position.y+dy/Math.max(1,scene.height-c.rect.height),0,1)};return;}
        if(mode==='resize'){const a=quad[0],b=quad[2],length=Math.hypot(b.x-a.x,b.y-a.y),travel=length>0?(dx*(b.x-a.x)+dy*(b.y-a.y))/(length*length):0;
          if(kind==='screenMotion')clip.target.scale=clamp(before.target.scale*(1+travel*2),0.2,4);else clip.scale=clamp(before.scale*(1+travel*2),1.1,4);
        }else if(kind==='screenMotion')clip.target.position={x:clamp(local.x,0,1),y:clamp(local.y,0,1)};
        else{clip.focus={x:clamp(crop.x+local.x*crop.width,0,1),y:clamp(crop.y+local.y*crop.height,0,1)};clip.origin='manual';}
      },{history:false});
    };
    const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);this.store.endGesture();};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
  }
}
module.exports={CanvasInteraction};
