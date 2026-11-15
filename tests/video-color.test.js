'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {videoColorSpace}=require('../src/core/video-color');
test('untagged H.264 uses the same SD/HD fallback as the Chromium media element',()=>{
  assert.equal(videoColorSpace({height:240}).matrix,'smpte170m');
  assert.equal(videoColorSpace({height:720}).matrix,'bt709');
});
test('explicit full-range BT.709 metadata overrides the SD fallback',()=>{
  assert.deepEqual(videoColorSpace({height:240,color_space:'bt709',color_primaries:'bt709',color_transfer:'bt709',color_range:'pc'}),
    {matrix:'bt709',primaries:'bt709',transfer:'bt709',fullRange:true});
});
