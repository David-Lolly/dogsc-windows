'use strict';
// Match Chromium's H.264 demux fallback: unspecified SD -> Rec.601,
// unspecified HD -> Rec.709. Explicit file metadata takes precedence.
// https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/ffmpeg/ffmpeg_common.cc
function videoColorSpace(stream) {
  const sd=stream.height<720;
  const primaries=new Set(['bt709','bt470bg','smpte170m','bt2020','smpte432']);
  const transfers=new Set(['bt709','smpte170m','iec61966-2-1','linear','pq','hlg']);
  const matrices=new Set(['rgb','bt709','bt470bg','smpte170m','bt2020-ncl']);
  const matrix={bt2020nc:'bt2020-ncl',gbr:'rgb'}[stream.color_space] || stream.color_space;
  const transfer={smpte2084:'pq','arib-std-b67':'hlg'}[stream.color_transfer] || stream.color_transfer;
  return { primaries:primaries.has(stream.color_primaries)?stream.color_primaries:sd?'smpte170m':'bt709',
    transfer:transfers.has(transfer)?transfer:sd?'smpte170m':'bt709',
    matrix:matrices.has(matrix)?matrix:sd?'smpte170m':'bt709',fullRange:stream.color_range==='pc' };
}
module.exports={videoColorSpace};
