"""Local speech recognition worker. Receives only a local extracted audio file."""
import json, os, sys
os.environ.setdefault('HF_HUB_DISABLE_XET','1')
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
import numpy as np

def transcribe(path, language=None):
    audio=decode_audio(path,sampling_rate=16000)
    if not audio.size or float(np.sqrt(np.mean(audio**2)))<1e-4:
        return {'language':language or 'auto','segments':[],'text':''}
    model=WhisperModel(os.environ.get('VEDIT_WHISPER_MODEL','small'),device='cpu',compute_type='int8',cpu_threads=4)
    segments, info=model.transcribe(audio,language=language,word_timestamps=True,vad_filter=False,beam_size=5,condition_on_previous_text=False)
    cues=[]
    for segment in segments:
        words=list(segment.words or [])
        if not words:
            if segment.text.strip(): cues.append({'start':segment.start,'end':segment.end,'text':segment.text.strip()})
            continue
        group=[]
        for word in words:
            if group and (word.end-group[0].start>3.5 or len(''.join(w.word for w in group))+len(word.word)>32):
                cues.append({'start':group[0].start,'end':group[-1].end,'text':''.join(w.word for w in group).strip()});group=[]
            group.append(word)
        if group:cues.append({'start':group[0].start,'end':group[-1].end,'text':''.join(w.word for w in group).strip()})
    return {'language':info.language,'segments':cues,'text':'\n'.join(c['text'] for c in cues)}

if __name__=='__main__':
    result=transcribe(sys.argv[1],None if sys.argv[3]=='auto' else sys.argv[3])
    with open(sys.argv[2],'w',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False)
