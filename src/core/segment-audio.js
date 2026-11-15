'use strict';
function segmentVolume(project,segment,kind){
  const override=segment.audio||{},microphone=kind==='microphone',volumeKey=microphone?'microphoneVolume':'systemVolume',muteKey=microphone?'isMicrophoneMuted':'isSystemMuted';
  return (override[muteKey]??project.audio[muteKey])?0:(override[volumeKey]??project.audio[volumeKey]);
}
module.exports={segmentVolume};
