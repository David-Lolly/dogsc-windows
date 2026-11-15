'use strict';
// 画面合成器：把 scene.js 求出的几何画到 2D 画布上。预览与导出走同一份代码，
// 对应 macOS 版的 SharedFrameRenderer（那边是 Core Image / Metal）。

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PATTERN_PRESETS } = require('../../core/model');
const { cursorLibrary } = require('./cursors');
const { ProjectiveTextureRenderer } = require('./projective-texture');
const { cameraContentLayout } = require('../../core/camera-content');
const { FocusRenderer } = require('./focus-renderer');
const {decorationGeometry}=require('../../core/screen-decoration');

function roundedRect(ctx, rect, radius) {
  const r = Math.max(Math.min(radius, rect.width / 2, rect.height / 2), 0);
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, r);
}

const frameSize = (frame) => ({
  width: frame.displayWidth || frame.videoWidth || frame.width,
  height: frame.displayHeight || frame.videoHeight || frame.height,
});

function loadImage(file) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = pathToFileURL(file).href;
  });
}

class Compositor {
  constructor(directory) {
    this.directory = directory;
    this.images = new Map();
    this.imageLoads = new Map();
    this.backgroundKey = null;
    this.background = null;
    this.cursors = cursorLibrary();
  }

  backgroundFile(background) {
    if (background.kind === 'image') return path.isAbsolute(background.file) ? background.file : path.join(this.directory, background.file);
    return null;
  }

  /// 背景图片异步解码；预览在加载完成后通过 onReady 重画，导出前显式 await。
  async prepare(project) {
    const background=this.backgroundFile(project.canvas.background);
    const files=[...(background?[background]:[]),...(project.timeline.stickerClips||[]).map(c=>path.resolve(this.directory,c.relativePath))];
    await Promise.all(files.map(async(file)=>{
      if(!this.imageLoads.has(file))this.imageLoads.set(file,loadImage(file));
      const image=await this.imageLoads.get(file);
      if(!image)throw new Error(`图片素材无法读取：${path.basename(file)}`);
      this.images.set(file,image);
    }));
  }

  redactFrame(frame,screen) {
    if(!frame || !screen.redactions?.length)return frame;
    const size=frameSize(frame),scale=Math.min(1,4096/size.width,4096/size.height,Math.sqrt(8_000_000/(size.width*size.height)));
    const width=Math.max(2,Math.round(size.width*scale)),height=Math.max(2,Math.round(size.height*scale));
    if(!this.redacted)this.redacted=new OffscreenCanvas(width,height);
    if(this.redacted.width!==width)this.redacted.width=width;if(this.redacted.height!==height)this.redacted.height=height;
    const ctx=this.redacted.getContext('2d');ctx.clearRect(0,0,width,height);ctx.drawImage(frame,0,0,width,height);
    for(const c of screen.redactions){
      const r={x:c.sourceRect.x*width,y:c.sourceRect.y*height,width:c.sourceRect.width*width,height:c.sourceRect.height*height};
      ctx.save();roundedRect(ctx,r,Math.min(r.width,r.height)*c.cornerRadius);ctx.clip();
      ctx.globalAlpha=c.progress;ctx.filter=`blur(${Math.max(0.5,c.intensity*40*Math.min(width,height)/1080)}px)`;
      ctx.drawImage(frame,0,0,width,height);ctx.restore();
    }
    return this.redacted;
  }

  drawSticker(ctx,sticker,scene) {
    const image=this.images.get(path.resolve(this.directory,sticker.relativePath));
    if(!image || sticker.opacity<=0)return;
    const width=sticker.width*scene.width*sticker.scale,height=width*image.naturalHeight/image.naturalWidth;
    const rect={x:-width/2,y:-height/2,width,height},s=scene.styleScale*sticker.scale;
    ctx.save();ctx.globalAlpha=sticker.opacity;ctx.translate((sticker.position.x+sticker.offset.x)*scene.width,(sticker.position.y+sticker.offset.y)*scene.height);
    ctx.rotate(sticker.rotationDegrees*Math.PI/180);
    this.drawShadow(ctx,rect,sticker.cornerRadius*s,{opacity:sticker.shadowOpacity,radius:sticker.shadowRadius*s,offsetX:sticker.shadowOffsetX*s,offsetY:sticker.shadowOffsetY*s});
    if(sticker.borderWidth>0){ctx.fillStyle=sticker.borderColor;const b=sticker.borderWidth*s;roundedRect(ctx,{x:rect.x-b,y:rect.y-b,width:width+b*2,height:height+b*2},sticker.cornerRadius*s+b);ctx.fill();}
    roundedRect(ctx,rect,sticker.cornerRadius*s);ctx.clip();ctx.drawImage(image,rect.x,rect.y,width,height);ctx.restore();
  }

  blurBackdrop(ctx,radius) {
    if(radius<=0.01)return;
    if(!this.backdropCopy)this.backdropCopy=new OffscreenCanvas(ctx.canvas.width,ctx.canvas.height);
    if(this.backdropCopy.width!==ctx.canvas.width)this.backdropCopy.width=ctx.canvas.width;
    if(this.backdropCopy.height!==ctx.canvas.height)this.backdropCopy.height=ctx.canvas.height;
    this.backdropCopy.getContext('2d').drawImage(ctx.canvas,0,0);
    ctx.save();ctx.filter=`blur(${radius}px)`;ctx.drawImage(this.backdropCopy,0,0);ctx.restore();
  }

  /// 背景整张缓存：点阵每帧重画上千个圆不划算，背景又不随时间变化。
  backgroundLayer(canvas, width, height, styleScale,time=0,videoFrame=null) {
    const file = this.backgroundFile(canvas.background);
    const image = videoFrame || (file ? this.images.get(file) : null);
    const dynamic=['dynamic','video'].includes(canvas.background.kind);
    const key = JSON.stringify([canvas.background, canvas.backgroundBlur, canvas.patternScale, canvas.patternOpacity, width, height, Boolean(image),dynamic?Math.round(time*1000000):0]);
    if (this.backgroundKey === key) return this.background;
    const layer = this.background&&this.background.width===width&&this.background.height===height?this.background:new OffscreenCanvas(width, height);
    const ctx = layer.getContext('2d', { alpha: false });
    const background = canvas.background;
    if (background.kind === 'color') {
      ctx.fillStyle = background.color;
      ctx.fillRect(0, 0, width, height);
    } else if (['image','video'].includes(background.kind) && image) {
      const size=image.naturalWidth?{width:image.naturalWidth,height:image.naturalHeight}:frameSize(image);
      const scale = Math.max(width / size.width, height / size.height);
      const blur = Math.max(canvas.backgroundBlur, 0) * styleScale;
      // 模糊会让边缘透出底色，画大一圈再裁回来。
      const bleed = blur * 3;
      const w = size.width * scale + bleed * 2;
      const h = size.height * scale + bleed * 2;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      if (blur > 0) ctx.filter = `blur(${blur}px)`;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
      ctx.filter = 'none';
    } else if(background.kind==='dynamic'){
      const preset=background.preset||'cyberDriftGrid',opacity=canvas.patternOpacity;
      if(preset==='auroraFluid'){
        const base=ctx.createLinearGradient(0,height,width,0);base.addColorStop(0,'#061633');base.addColorStop(1,'#040713');ctx.fillStyle=base;ctx.fillRect(0,0,width,height);
        const phases=[[0.19,0.27,0.56,[20,107,245],0.82],[0.14,0.22,0.42,[20,212,245],0.62],[0.11,0.17,0.32,[230,247,255],0.7]];
        phases.forEach(([a,b,r,color,alpha],i)=>{const x=width/2+Math.cos(time*a+i*2.18)*width*0.36,y=height/2-Math.sin(time*b+i*2.18*0.73)*height*0.34,radius=Math.min(width,height)*r*canvas.patternScale;
          const g=ctx.createRadialGradient(x,y,0,x,y,radius*3);for(let k=0;k<=12;k++)g.addColorStop(k/12,`rgba(${color.join(',')},${Math.exp(-0.5*(k/4)**2)*alpha*opacity})`);ctx.fillStyle=g;ctx.fillRect(0,0,width,height);});
      }else{
        ctx.fillStyle=preset==='starfieldDots'?'#111111':'#0F0F0F';ctx.fillRect(0,0,width,height);
        const tile=Math.max(Math.min(width,height)*(preset==='starfieldDots'?0.032:0.0425)*canvas.patternScale,9);
        ctx.save();ctx.translate((time*tile*(preset==='starfieldDots'?0.07:0.1))%tile,-(time*tile*(preset==='starfieldDots'?0.04:0.065))%tile);
        ctx.globalAlpha=opacity;ctx.strokeStyle='#3D3D3D';ctx.fillStyle='rgba(194,173,138,0.9)';ctx.lineWidth=Math.max(styleScale,1);
        for(let x=-tile;x<width+tile;x+=tile)for(let y=-tile;y<height+tile;y+=tile){if(preset==='starfieldDots'){ctx.beginPath();ctx.arc(x,y,Math.max(tile*0.055,0.9),0,Math.PI*2);ctx.fill();}else ctx.strokeRect(x,y,tile,tile);}ctx.restore();
      }
    } else {
      this.drawPattern(ctx, PATTERN_PRESETS[background.preset] || PATTERN_PRESETS.obsidianGrid, canvas, width, height);
    }
    this.backgroundKey = key;
    this.background = layer;
    return layer;
  }

  drawPattern(ctx, preset, canvas, width, height) {
    ctx.fillStyle = preset.background;
    ctx.fillRect(0, 0, width, height);
    const shortEdge = Math.max(Math.min(width, height), 2);
    const tile = Math.max(shortEdge * preset.fraction * canvas.patternScale, 9);
    ctx.globalAlpha = Math.min(Math.max(canvas.patternOpacity, 0), 1);
    // 图案以画布中心为基准铺开，换分辨率时构图不漂移。
    const originX = (width / 2) % tile;
    const originY = (height / 2) % tile;
    if (preset.kind === 'dots') {
      ctx.fillStyle = preset.dot;
      const radius = Math.max(tile * 0.055, 0.9);
      ctx.beginPath();
      for (let y = originY - tile; y < height + tile; y += tile) {
        for (let x = originX - tile; x < width + tile; x += tile) {
          ctx.moveTo(x + radius, y);
          ctx.arc(x, y, radius, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    } else {
      ctx.strokeStyle = preset.stroke;
      ctx.lineWidth = Math.max(shortEdge / 1080, 1);
      ctx.beginPath();
      if (preset.kind === 'grid') {
        for (let x = originX - tile; x < width + tile; x += tile) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
        for (let y = originY - tile; y < height + tile; y += tile) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      } else {
        // 等角网：±30° 两组斜线加一组竖线。
        const slope = Math.tan(Math.PI / 6);
        const span = width * slope;
        for (let y = originY - span - tile; y < height + span + tile; y += tile) {
          ctx.moveTo(0, y); ctx.lineTo(width, y + span);
          ctx.moveTo(0, y + span); ctx.lineTo(width, y);
        }
        const step = tile / slope / 2;
        for (let x = (width / 2) % step - step; x < width + step; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawShadow(ctx, rect, radius, shadow) {
    if (!shadow || shadow.opacity <= 0) return;
    ctx.save();
    // Core Image 的高斯半径是 σ，画布 shadowBlur 约等于 2σ。
    ctx.shadowColor = `rgba(0,0,0,${shadow.opacity})`;
    ctx.shadowBlur = shadow.radius * 2;
    ctx.shadowOffsetX = shadow.offsetX || 0;
    ctx.shadowOffsetY = shadow.offsetY;
    ctx.fillStyle = '#000';
    // Draw only the shadow into the destination. Move the opaque caster out
    // of the bitmap and offset its shadow back; this also avoids black AA
    // fringes where a light frame and its caster meet. Account for the active
    // transform (projective layer rasterization and rotated stickers).
    const matrix=ctx.getTransform(),det=matrix.a*matrix.d-matrix.b*matrix.c;
    if(Math.abs(det)<1e-12){ctx.restore();return;}
    const farX=Math.max(...[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]].map(([x,y])=>matrix.a*x+matrix.c*y+matrix.e));
    const shift=Math.max(ctx.canvas.width,farX,0)+shadow.radius*6+Math.abs(shadow.offsetX||0)+100;
    ctx.shadowOffsetX+=shift;
    ctx.translate(-shift*matrix.d/det,shift*matrix.b/det);
    roundedRect(ctx, rect, radius);
    ctx.fill();
    ctx.restore();
  }

  drawScreen(ctx, screen, frame) {
    const rect = screen.finalRect;
    const border = screen.borderWidth;
    const outer = border > 0
      ? { x: rect.x - border, y: rect.y - border, width: rect.width + border * 2, height: rect.height + border * 2 }
      : rect;
    const d=screen.decoration;
    const geometry=decorationGeometry(screen),decorated=geometry.rect;
    // Shadow caster and visible chrome must share the exact same outline.
    // A smaller caster radius exposes opaque black wedges at all four corners.
    this.drawShadow(ctx, decorated, geometry.radius, screen.shadow);
    if(d&&d.style!=='none'){ctx.save();roundedRect(ctx,decorated,geometry.radius);ctx.clip();}
    if(d&&d.style!=='none'){
      const dark=/Dark|device/.test(d.style);ctx.save();ctx.globalAlpha*=d.insetOpacity??1;ctx.fillStyle=dark?'#202124':'#F4F4F5';roundedRect(ctx,decorated,geometry.radius);ctx.fill();ctx.clip();
      if(!d.style.startsWith('device')){
        const y=rect.y-d.top/2,s=d.scale;for(let i=0;i<3;i++){ctx.fillStyle=['#ff6059','#ffbd2e','#28c840'][i];ctx.beginPath();ctx.arc(rect.x+(12+i*17)*s,y,4.5*s,0,Math.PI*2);ctx.fill();}
        ctx.fillStyle=dark?'#dedede':'#454545';ctx.font=`${Math.max(8,12*s)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(d.style.startsWith('browser')?d.address:d.title,rect.x+rect.width/2,y,Math.max(1,rect.width-130*s));
      }else{ctx.fillStyle='#080808';roundedRect(ctx,{x:rect.x+rect.width*0.35,y:rect.y-d.top*0.75,width:rect.width*0.3,height:d.top*0.3},d.top*0.15);ctx.fill();}ctx.restore();
    }
    if (border > 0) {
      ctx.fillStyle = screen.borderColor;
      roundedRect(ctx, outer, screen.cornerRadius + border);
      ctx.fill();
    }
    ctx.save();
    roundedRect(ctx, rect, screen.cornerRadius);
    ctx.clip();
    if (frame) {
      const crop = screen.crop, size = frameSize(frame);
      ctx.drawImage(frame, size.width * crop.x, size.height * crop.y, size.width * crop.width, size.height * crop.height,
        rect.x, rect.y, rect.width, rect.height);
    } else {
      ctx.fillStyle = '#1b1c20';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.restore();
    if(d&&d.style!=='none')ctx.restore();
  }

  drawRing(ctx, x, y, ring, color) {
    if (!ring || ring.opacity <= 0 || ring.diameter <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(ring.opacity, 1);
    ctx.shadowColor = color;
    ctx.shadowBlur = ring.glow * 2;
    ctx.beginPath();
    ctx.arc(x, y, ring.diameter / 2, 0, Math.PI * 2);
    if (ring.filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = ring.lineWidth;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCursor(ctx, screen, cursor) {
    ctx.save();
    // 光标属于屏幕内容：跟着屏幕卡片一起被圆角裁切。
    roundedRect(ctx, screen.finalRect, screen.cornerRadius);
    ctx.clip();
    if (cursor.click) {
      const color = cursor.clickColor || '#FFFFFF';
      this.drawRing(ctx, cursor.x, cursor.y, cursor.click.primary, color);
      this.drawRing(ctx, cursor.x, cursor.y, cursor.click.secondary, color);
      const accent = cursor.click.accent;
      if (accent && accent.opacity > 0) {
        ctx.save();
        ctx.globalAlpha = accent.opacity;
        ctx.fillStyle = color;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.beginPath();
          ctx.arc(cursor.x + dx * accent.offset, cursor.y + dy * accent.offset, accent.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    const sprite = this.cursors[cursor.appearance] || this.cursors.arrow;
    const scale = cursor.height / this.cursors.referenceHeight;
    ctx.shadowColor = `rgba(0,0,0,${cursor.shadow.opacity})`;
    ctx.shadowBlur = cursor.shadow.radius * 2;
    ctx.shadowOffsetY = cursor.shadow.offsetY;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(cursor.x,cursor.y);
    ctx.rotate(cursor.rotationRadians || 0);
    ctx.drawImage(sprite.canvas, -sprite.hotspotX * scale, -sprite.hotspotY * scale, sprite.width * scale, sprite.height * scale);
    ctx.restore();
  }

  drawCamera(ctx, camera, frame) {
    if ((camera.opacity ?? 1)<=0) return;
    ctx.save();ctx.globalAlpha*=camera.opacity ?? 1;
    const rect = camera.rect;
    const border = camera.borderWidth;
    const outer = { x: rect.x - border, y: rect.y - border, width: rect.width + border * 2, height: rect.height + border * 2 };
    this.drawShadow(ctx, outer, camera.cornerRadius + border, camera.shadow);
    if (border > 0) {
      ctx.fillStyle = '#FFFFFF';
      roundedRect(ctx, outer, camera.cornerRadius + border);
      ctx.fill();
    }
    ctx.save();
    roundedRect(ctx, rect, camera.cornerRadius);
    ctx.clip();
    // 居中等比填充（aspect-fill）。
    const source = frameSize(frame);
    const destination = cameraContentLayout(source, rect, camera.contentPosition, camera.contentScale);
    if (!destination) { ctx.restore(); ctx.restore(); return; }
    if (camera.isMirrored) {
      ctx.translate(rect.x * 2 + rect.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frame, destination.x, destination.y, destination.width, destination.height);
    ctx.restore();
    ctx.restore();
  }

  /// frames: { screen, camera }，可以是 <video> 或 WebCodecs VideoFrame。
  draw(ctx, project, scene, frames) {
    const { width, height } = scene;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.backgroundLayer(project.canvas, width, height, scene.styleScale,scene.time,frames.background), 0, 0);
    const backdrop=scene.backdrop||{screenSuppression:0,cameraSuppression:0,screenBlur:0,cameraBlur:0};
    const screenFrame=this.redactFrame(frames.screen,scene.screen);
    ctx.save();ctx.globalAlpha=(scene.screen.opacity ?? 1)*(1-backdrop.screenSuppression);
    if (scene.screen.layerQuad) {
      // Rasterize the entire card, including parts outside the output canvas:
      // rotation can bring those pixels back into view. Bound GPU allocations
      // independently of authored zoom, then project into output resolution.
      const bounds = scene.screen.layerRect;
      const rasterScale = Math.min(1, 4096 / bounds.width, 4096 / bounds.height, Math.sqrt(8_000_000 / (bounds.width * bounds.height)));
      const layerWidth = Math.max(2, Math.ceil(bounds.width * rasterScale));
      const layerHeight = Math.max(2, Math.ceil(bounds.height * rasterScale));
      if (!this.screenLayer) this.screenLayer = new OffscreenCanvas(layerWidth, layerHeight);
      if (this.screenLayer.width !== layerWidth || this.screenLayer.height !== layerHeight) {
        this.screenLayer.width = layerWidth; this.screenLayer.height = layerHeight;
      }
      const layer = this.screenLayer.getContext('2d');
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, layerWidth, layerHeight);
      layer.setTransform(layerWidth / bounds.width, 0, 0, layerHeight / bounds.height,
        -bounds.x * layerWidth / bounds.width, -bounds.y * layerHeight / bounds.height);
      this.drawScreen(layer, scene.screen, screenFrame);
      if (scene.cursor) this.drawCursor(layer, scene.screen, scene.cursor);
      if (!this.projection) {
        this.projection = new ProjectiveTextureRenderer(new OffscreenCanvas(width, height));
      }
      if (this.projection.canvas.width !== width) this.projection.canvas.width = width;
      if (this.projection.canvas.height !== height) this.projection.canvas.height = height;
      this.projection.draw(this.screenLayer, scene.screen.layerQuad);
      ctx.drawImage(this.projection.canvas, 0, 0);
    } else {
      this.drawScreen(ctx, scene.screen, screenFrame);
      if (scene.cursor) this.drawCursor(ctx, scene.screen, scene.cursor);
    }
    ctx.restore();
    if (scene.screen.focusEffect || scene.screen.spotlights?.length) {
      if (!this.focusRenderer) this.focusRenderer=new FocusRenderer();
      this.focusRenderer.draw(ctx,scene);
    }
    this.blurBackdrop(ctx,backdrop.screenBlur*scene.styleScale);
    if (scene.camera && frames.camera) {
      ctx.save();ctx.filter=backdrop.cameraBlur>0?`blur(${backdrop.cameraBlur*scene.styleScale}px)`:'none';
      this.drawCamera(ctx,{...scene.camera,opacity:(scene.camera.opacity??1)*(1-backdrop.cameraSuppression)},frames.camera);ctx.restore();
    }
    for(const sticker of scene.stickers||[])this.drawSticker(ctx,sticker,scene);
  }

  dispose() {
    if (this.projection) this.projection.dispose();
    this.projection = null;
    this.screenLayer = null;
    this.focusRenderer?.dispose();this.focusRenderer=null;
    this.redacted=null;this.backdropCopy=null;this.images.clear();this.imageLoads.clear();
  }
}

module.exports = { Compositor };
