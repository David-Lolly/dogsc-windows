'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeProject,validateProjectContract}=require('../src/core/model');
const {makeSticker,makeMosaic,sampleStickers,sampleMosaics}=require('../src/core/overlays');
const make=()=>makeProject({name:'overlays',media:{screen:{width:640,height:360,duration:10}}});
test('sticker timing, entry, exit and layer order survive JSON persistence',()=>{
  const p=make(),a=makeSticker('media/a.png',1,3,2),b=makeSticker('media/b.png',1,3,1);p.timeline.stickerClips=[a,b];
  validateProjectContract(p);const saved=JSON.parse(JSON.stringify(p));
  assert.equal(sampleStickers(saved,0,640,360).stickers.length,0);
  assert.equal(sampleStickers(saved,1,640,360).stickers[0].opacity,0);
  const middle=sampleStickers(saved,2,640,360);assert.equal(middle.stickers[0].relativePath,'media/b.png');assert.equal(middle.stickers[0].opacity,1);
  assert.equal(sampleStickers(saved,4,640,360).stickers.length,0);
});
test('adjacent hidden-screen stickers maintain suppression throughout handoff',()=>{
  const p=make(),a=makeSticker('media/a.png',0,2),b=makeSticker('media/b.png',2,2);a.hidesScreen=true;b.hidesScreen=true;p.timeline.stickerClips=[a,b];
  for(const time of [1.9,1.99,2,2.1,2.3])assert.equal(sampleStickers(p,time,640,360).backdrop.screenSuppression,1);
});
test('redaction defaults to immediate coverage, authored fades have bounded envelopes',()=>{
  const p=make(),c=makeMosaic(1,2);p.timeline.mosaicClips=[c];assert.equal(sampleMosaics(p,1)[0].progress,1);
  c.transitionStyle='linear';assert.equal(sampleMosaics(p,1)[0].progress,0);
  assert.ok(Math.abs(sampleMosaics(p,1.15)[0].progress-0.5)<1e-9);assert.equal(sampleMosaics(p,3).length,0);
});
test('invalid region geometry and traversing sticker asset paths are rejected',()=>{
  const p=make();p.timeline.mosaicClips=[makeMosaic(0,2)];p.timeline.mosaicClips[0].sourceRect.width=2;assert.throws(()=>validateProjectContract(p),/区域/);
  p.timeline.mosaicClips=[];p.timeline.stickerClips=[makeSticker('../source.png',0,2)];assert.throws(()=>validateProjectContract(p),/路径/);
});
