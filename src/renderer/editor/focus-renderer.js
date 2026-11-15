'use strict';
const { ProjectiveTextureRenderer } = require('./projective-texture');

class FocusRenderer {
  surface(key,width,height,opaque=false) {
    let value=this[key];
    if (!value) value=this[key]=new OffscreenCanvas(width,height);
    if (value.width!==width) value.width=width;
    if (value.height!==height) value.height=height;
    return { canvas:value,ctx:value.getContext('2d',{alpha:!opaque}) };
  }

  draw(ctx,scene) {
    const spotlights=scene.screen.spotlights||[];
    const focus=scene.screen.focusEffect;
    const effect={...(focus?.effect||{shape:'radial',size:0.45,blur:0,softness:0.5,dimming:0})};
    effect.blur=Math.max(effect.blur,...spotlights.map(c=>c.intensity),0);effect.dimming=Math.max(effect.dimming,...spotlights.map(c=>c.spotlightDimming),0);
    const center=focus?.center||{x:0.5,y:0.5},progress=Math.max(focus?.progress||0,...spotlights.map(c=>c.progress),0);
    const { width,height }=scene,screen=scene.screen,rect=screen.finalRect;
    const snapshot=this.surface('snapshot',width,height,true);
    snapshot.ctx.drawImage(ctx.canvas,0,0);
    const outside=this.surface('outside',width,height,true);
    const radius=effect.blur*28*Math.min(width,height)/1080;
    if (radius>0.01) {
      // Replicate edge texels before blurring, matching clamped-to-extent
      // behavior instead of introducing transparent/dark output borders.
      const pad=Math.ceil(radius*3)+1;
      const padded=this.surface('padded',width+pad*2,height+pad*2,true),p=padded.ctx,s=snapshot.canvas;
      p.drawImage(s,pad,pad);
      p.drawImage(s,0,0,1,height,0,pad,pad,height);p.drawImage(s,width-1,0,1,height,pad+width,pad,pad,height);
      p.drawImage(s,0,0,width,1,pad,0,width,pad);p.drawImage(s,0,height-1,width,1,pad,pad+height,width,pad);
      for (const [sx,sy,dx,dy] of [[0,0,0,0],[width-1,0,pad+width,0],[0,height-1,0,pad+height],[width-1,height-1,pad+width,pad+height]])
        p.drawImage(s,sx,sy,1,1,dx,dy,pad,pad);
      outside.ctx.filter=`blur(${radius}px)`;outside.ctx.drawImage(padded.canvas,-pad,-pad);outside.ctx.filter='none';
    } else outside.ctx.drawImage(snapshot.canvas,0,0);
    if (effect.dimming>0) {outside.ctx.fillStyle=`rgba(0,0,0,${effect.dimming})`;outside.ctx.fillRect(0,0,width,height);}

    const bounds=screen.layerQuad ? screen.layerRect : {x:0,y:0,width,height};
    const scale=Math.min(1,4096/bounds.width,4096/bounds.height,Math.sqrt(8_000_000/(bounds.width*bounds.height)));
    const mask=this.surface('mask',Math.max(2,Math.ceil(bounds.width*scale)),Math.max(2,Math.ceil(bounds.height*scale)));
    const m=mask.ctx;m.setTransform(1,0,0,1,0,0);m.clearRect(0,0,mask.canvas.width,mask.canvas.height);
    m.setTransform(mask.canvas.width/bounds.width,0,0,mask.canvas.height/bounds.height,
      -bounds.x*mask.canvas.width/bounds.width,-bounds.y*mask.canvas.height/bounds.height);
    const x=rect.x+center.x*rect.width,y=rect.y+center.y*rect.height;
    const clear=Math.min(rect.width,rect.height)*effect.size/2;
    let gradient;
    if (effect.shape==='linear') {
      const a=(effect.angleDegrees || 0)*Math.PI/180,nx=-Math.sin(a),ny=Math.cos(a);
      const feather=Math.max(Math.min(rect.width,rect.height)*effect.softness*0.4,1),outer=clear+feather;
      gradient=m.createLinearGradient(x-nx*outer,y-ny*outer,x+nx*outer,y+ny*outer);
      gradient.addColorStop(0,'rgba(255,255,255,0)');gradient.addColorStop(feather/(2*outer),'white');
      gradient.addColorStop(1-feather/(2*outer),'white');gradient.addColorStop(1,'rgba(255,255,255,0)');
    } else {
      const outer=clear+Math.max(clear*effect.softness*1.5,0.5);
      gradient=m.createRadialGradient(x,y,clear,x,y,outer);
      gradient.addColorStop(0,'white');gradient.addColorStop(1,'rgba(255,255,255,0)');
    }
    if(focus){m.fillStyle=gradient;m.fillRect(bounds.x,bounds.y,bounds.width,bounds.height);}
    for(const c of spotlights){
      const crop=screen.crop,r=c.sourceRect;
      const left=Math.max(r.x,crop.x),top=Math.max(r.y,crop.y),right=Math.min(r.x+r.width,crop.x+crop.width),bottom=Math.min(r.y+r.height,crop.y+crop.height);
      if(right<=left||bottom<=top)continue;
      m.beginPath();m.roundRect(rect.x+(left-crop.x)/crop.width*rect.width,rect.y+(top-crop.y)/crop.height*rect.height,
        (right-left)/crop.width*rect.width,(bottom-top)/crop.height*rect.height,Math.min((right-left)/crop.width*rect.width,(bottom-top)/crop.height*rect.height)*c.cornerRadius);
      m.fillStyle='white';m.fill();
    }
    let outputMask=mask.canvas;
    if (screen.layerQuad) {
      if (!this.projection) this.projection=new ProjectiveTextureRenderer(new OffscreenCanvas(width,height));
      if (this.projection.canvas.width!==width) this.projection.canvas.width=width;
      if (this.projection.canvas.height!==height) this.projection.canvas.height=height;
      this.projection.draw(mask.canvas,screen.layerQuad);outputMask=this.projection.canvas;
    }
    const sharp=this.surface('sharp',width,height);
    sharp.ctx.globalCompositeOperation='copy';sharp.ctx.drawImage(snapshot.canvas,0,0);
    sharp.ctx.globalCompositeOperation='destination-in';sharp.ctx.drawImage(outputMask,0,0,width,height);
    sharp.ctx.globalCompositeOperation='source-over';outside.ctx.drawImage(sharp.canvas,0,0);
    ctx.save();ctx.globalAlpha=progress;ctx.drawImage(outside.canvas,0,0);ctx.restore();
  }

  dispose() {this.projection?.dispose();this.projection=null;for (const key of ['snapshot','outside','padded','mask','sharp']) this[key]=null;}
}
module.exports={FocusRenderer};
