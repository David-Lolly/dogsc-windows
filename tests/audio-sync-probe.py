"""Synthetic A/V pulse verification of the app's actual mux argument builder.
Does not access capture devices or prove real-device clock synchronization.
"""
import array
import json
import math
import pathlib
import subprocess
import wave

root = pathlib.Path(__file__).resolve().parents[2]
output = root / 'analysis/results/audio-sync'
output.mkdir(parents=True, exist_ok=True)

def run(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          creationflags=subprocess.CREATE_NO_WINDOW).stdout

def ffmpeg(*args):
    return run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)])

# Produce an already-edited elementary video stream, as the app renderer does.
raw = output / 'edited.h264'
ffmpeg('-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=4',
       '-filter_complex', "[0:v]drawbox=color=white:t=fill:enable='between(t,1,1.1)+between(t,3,3.1)',split=2[a][b];"
       '[a]trim=start=0.5:end=1.5,setpts=PTS-STARTPTS[v0];'
       '[b]trim=start=2.5:end=3.5,setpts=(PTS-STARTPTS)/2[v1];'
       '[v0][v1]concat=n=2:v=1:a=0,fps=30[v]', '-map', '[v]', '-an', '-c:v', 'libx264', '-f', 'h264', raw)

reports = []
for offset in (0.25, -0.25):
    name = 'late-track' if offset > 0 else 'early-track'
    audio = output / (name + '.wav')
    samples = array.array('h', [0]) * (48000 * 4)
    for onset in (1 - offset, 3 - offset):
        for index in range(round(onset * 48000), round((onset + 0.08) * 48000)):
            samples[index] = round(20000 * math.sin(2 * math.pi * 1000 * index / 48000))
    with wave.open(str(audio), 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(48000); stream.writeframes(samples.tobytes())
    video = output / (name + '.mp4')
    job = {'videoFile': str(raw), 'frameRate': 30, 'audioTracks': [{'file': str(audio), 'offset': offset, 'volume': 1}],
           'segments': [{'sourceStart': 0.5, 'sourceEnd': 1.5, 'speed': 1}, {'sourceStart': 2.5, 'sourceEnd': 3.5, 'speed': 2}],
           'sourceDuration': 4, 'outputDuration': 1.5, 'outputFile': str(video)}
    job_file = output / (name + '.json'); job_file.write_text(json.dumps(job), encoding='utf-8')
    script = "const fs=require('fs');const m=require('./windows/src/main/ffmpeg');process.stdout.write(JSON.stringify(m.buildMuxArguments(JSON.parse(fs.readFileSync(process.argv[1],'utf8')))));"
    arguments = json.loads(run(['node', '-e', script, str(job_file)]))
    ffmpeg(*arguments)
    pcm = array.array('h'); pcm.frombytes(ffmpeg('-i', video, '-vn', '-f', 's16le', '-ac', 1, '-ar', 48000, 'pipe:1'))
    # Group high-energy 5ms windows into pulse events, ignoring codec noise.
    active = [sum(abs(v) for v in pcm[i:i + 240]) / 240 > 1500 for i in range(0, len(pcm), 240)]
    audio_onsets = [i * 0.005 for i, value in enumerate(active) if value and (i == 0 or not active[i - 1])]
    pixels = ffmpeg('-i', video, '-an', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', 'pipe:1')
    video_onsets = [i / 30 for i, value in enumerate(pixels) if value > 180 and (i == 0 or pixels[i - 1] <= 180)]
    if len(audio_onsets) != 2 or len(video_onsets) != 2:
        raise AssertionError({'audio': audio_onsets, 'video': video_onsets})
    errors = [abs(a - v) for a, v in zip(audio_onsets, video_onsets)]
    if max(errors) > 1 / 30 + 0.005:
        raise AssertionError({'syncErrors': errors})
    reports.append({'offsetSeconds': offset, 'audioPulseSeconds': audio_onsets, 'videoFlashSeconds': video_onsets,
                    'absoluteErrorsSeconds': errors, 'passed': True})
report = {'syntheticOnly': True, 'passed': True, 'acceptanceSeconds': 1 / 30 + 0.005,
          'cases': reports, 'notValidated': ['device start latency', 'independent clock drift', 'long recording', 'camera sync anchors']}
(output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
