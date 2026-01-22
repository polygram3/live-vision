
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { AppStatus, TranscriptionItem, LiveConfig } from './types';
import { decode, decodeAudioData, createPcmBlob, blobToBase64, resample } from './utils/audio-utils';

const FRAME_RATE = 2; 
const JPEG_QUALITY = 0.9;
const GEMINI_INPUT_RATE = 16000;
const GEMINI_OUTPUT_RATE = 24000;

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentOutput, setCurrentOutput] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [isAiTalking, setIsAiTalking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [config, setConfig] = useState<LiveConfig>({
    voiceName: 'Zephyr',
    systemInstruction: 'You are an advanced AI vision assistant. CRITICAL LANGUAGE RULE: You MUST detect the language the user is currently speaking and respond ONLY in that EXACT same language. If the user speaks English, you MUST respond in English. If the user speaks Hindi, you MUST respond in Hindi. NEVER switch to a language different from the one used by the user in their most recent turn. You see through the user\'s webcam and describe the world as a helpful, observant companion.',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  
  // Ref to track mute status inside the audio processing closure
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (frameIntervalRef.current) {
      window.clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (audioContextInRef.current) {
      audioContextInRef.current.close();
      audioContextInRef.current = null;
    }
    if (audioContextOutRef.current) {
      audioContextOutRef.current.close();
      audioContextOutRef.current = null;
    }
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    activeSourcesRef.current.clear();
    
    setCurrentInput('');
    setCurrentOutput('');
    setIsAiTalking(false);
    setMicLevel(0);
    setStatus(AppStatus.IDLE);
  }, []);

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  const startSession = async () => {
    try {
      setStatus(AppStatus.CONNECTING);
      setErrorMessage(null);

      // Re-initialize with the latest API key from environment
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

      const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
      audioContextInRef.current = new AudioCtx();
      audioContextOutRef.current = new AudioCtx({ sampleRate: GEMINI_OUTPUT_RATE });
      
      await audioContextInRef.current.resume();
      await audioContextOutRef.current.resume();
      
      const inputSampleRate = audioContextInRef.current.sampleRate;
      nextStartTimeRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }, 
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } } 
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus(AppStatus.CONNECTED);

            if (audioContextInRef.current) {
              const source = audioContextInRef.current.createMediaStreamSource(stream);
              const scriptProcessor = audioContextInRef.current.createScriptProcessor(4096, 1, 1);
              
              scriptProcessor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Calculate volume level for UI visualization
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
                const rms = Math.sqrt(sum / inputData.length);
                const level = Math.min(100, rms * 500);
                setMicLevel(level);

                // Check for AI talking OR local mute using the ref to avoid stale closure
                if (activeSourcesRef.current.size > 0 || isMutedRef.current) return; 

                const resampledData = resample(inputData, inputSampleRate, GEMINI_INPUT_RATE);
                const pcmBlob = createPcmBlob(resampledData);

                sessionPromise.then((session) => {
                  if (session) session.sendRealtimeInput({ media: pcmBlob });
                });
              };

              source.connect(scriptProcessor);
              scriptProcessor.connect(audioContextInRef.current.destination);
            }

            frameIntervalRef.current = window.setInterval(() => {
              if (videoRef.current && canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                  const v = videoRef.current;
                  if (v.videoWidth > 0) {
                    canvasRef.current.width = v.videoWidth;
                    canvasRef.current.height = v.videoHeight;
                    ctx.drawImage(v, 0, 0);
                    canvasRef.current.toBlob(async (blob) => {
                      if (blob) {
                        const base64Data = await blobToBase64(blob);
                        sessionPromise.then((session) => {
                          if (session) session.sendRealtimeInput({
                            media: { data: base64Data, mimeType: 'image/jpeg' }
                          });
                        });
                      }
                    }, 'image/jpeg', JPEG_QUALITY);
                  }
                }
              }
            }, 1000 / FRAME_RATE);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && audioContextOutRef.current) {
              const ctx = audioContextOutRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, GEMINI_OUTPUT_RATE, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              source.addEventListener('ended', () => {
                activeSourcesRef.current.delete(source);
                if (activeSourcesRef.current.size === 0) setIsAiTalking(false);
              });
              
              setIsAiTalking(true);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              activeSourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              activeSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsAiTalking(false);
            }

            if (message.serverContent?.inputTranscription) {
              setCurrentInput(prev => prev + message.serverContent!.inputTranscription!.text);
            }
            if (message.serverContent?.outputTranscription) {
              setCurrentOutput(prev => prev + message.serverContent!.outputTranscription!.text);
            }

            if (message.serverContent?.turnComplete) {
              setTranscriptions(prev => {
                const newHistory = [...prev];
                setCurrentInput(input => {
                  if (input) newHistory.push({ type: 'user', text: input, timestamp: Date.now() });
                  return '';
                });
                setCurrentOutput(output => {
                  if (output) newHistory.push({ type: 'model', text: output, timestamp: Date.now() });
                  return '';
                });
                return newHistory;
              });
            }
          },
          onerror: (e) => {
            setErrorMessage('Session encountered an error. Please restart.');
            stopSession();
          },
          onclose: () => stopSession()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voiceName } }
          },
          systemInstruction: config.systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      setErrorMessage(err.message || 'Link failed.');
      setStatus(AppStatus.ERROR);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-4 lg:p-6 flex flex-col font-sans selection:bg-blue-500/30">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 glass p-4 rounded-3xl border-white/10 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-blue-600 rounded-2xl shadow-lg shadow-blue-500/20 ring-1 ring-white/10">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Vision Interface</h1>
            <p className="text-[10px] text-blue-400 font-mono uppercase tracking-[0.2em] leading-none mt-1 font-semibold">
              Gemini Live v2.5
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto">
          {status === AppStatus.CONNECTED && (
            <button 
              onClick={toggleMute}
              className={`p-2.5 rounded-full border transition-all ${isMuted ? 'bg-red-500/20 border-red-500/50 text-red-500' : 'bg-white/5 border-white/10 text-white hover:bg-white/10'}`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
          )}

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${status === AppStatus.CONNECTED ? 'bg-blue-500 animate-pulse' : 'bg-zinc-600'}`} />
            <span className="text-zinc-400 uppercase font-black">{status}</span>
          </div>

          <button 
            onClick={status === AppStatus.CONNECTED ? stopSession : startSession}
            disabled={status === AppStatus.CONNECTING}
            className={`flex-1 sm:flex-none px-8 py-2.5 rounded-2xl font-bold uppercase text-[11px] tracking-widest transition-all active:scale-95 shadow-lg ${
              status === AppStatus.CONNECTED 
                ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20' 
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'
            }`}
          >
            {status === AppStatus.CONNECTED ? 'Kill Link' : status === AppStatus.CONNECTING ? 'Connecting...' : 'Establish Link'}
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 overflow-hidden">
        <div className="xl:col-span-8 flex flex-col gap-6 overflow-hidden">
          <div className={`relative flex-1 bg-black rounded-[2.5rem] overflow-hidden border transition-all duration-700 ${isAiTalking ? 'border-blue-500/40 shadow-[0_0_60px_rgba(59,130,246,0.15)]' : 'border-white/5'} group shadow-2xl`}>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className={`w-full h-full object-cover transition-opacity duration-1000 ${status === AppStatus.CONNECTED ? 'opacity-100' : 'opacity-20 blur-2xl'}`} 
            />
            
            {/* TOP-RIGHT MINI WAVE VISUALIZER */}
            {status === AppStatus.CONNECTED && (
              <div className="absolute top-8 right-8 flex items-end gap-[3px] pointer-events-none z-30">
                {[...Array(12)].map((_, i) => {
                  const level = isAiTalking ? 5 + Math.random() * 20 : (isMuted ? 2 : (micLevel / 100) * 40 * (0.5 + Math.random() * 0.5));
                  return (
                    <div 
                      key={i} 
                      className={`w-1 rounded-full transition-all duration-150 ${isAiTalking ? 'bg-blue-400' : 'bg-white/40'}`}
                      style={{ height: `${Math.max(2, level)}px` }}
                    />
                  );
                })}
              </div>
            )}

            {/* SIMPLE CIRCULAR VISUALIZER (Center) */}
            {status === AppStatus.CONNECTED && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <div className="relative">
                  <div 
                    className={`absolute inset-[-40px] rounded-full border transition-all duration-300 ${isAiTalking ? 'border-blue-400/40 scale-110' : 'border-white/10 scale-100'}`}
                    style={{ transform: `scale(${1 + (isAiTalking ? 0.05 : (isMuted ? 0 : micLevel / 200))})` }}
                  />
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${isAiTalking ? 'border-blue-400 bg-blue-500/10' : 'border-white/20 bg-white/5'}`}>
                    <div className={`w-2 h-2 rounded-full transition-all duration-300 ${isAiTalking ? 'bg-blue-400 scale-150 animate-pulse' : (!isMuted && micLevel > 15) ? 'bg-white' : 'bg-zinc-800'}`} />
                  </div>
                </div>
              </div>
            )}

            {/* SPLIT SUBTITLES */}
            {status === AppStatus.CONNECTED && (
              <div className="absolute inset-0 p-10 flex flex-col justify-end pointer-events-none z-40">
                <div className="flex justify-between items-end gap-16 w-full">
                  <div className={`flex-1 flex flex-col items-start transition-all duration-500 ${currentOutput ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    <div className="glass-subtitle px-6 py-4 rounded-3xl max-w-lg border-l-4 border-blue-500/80">
                      <p className="text-white text-lg font-medium leading-relaxed drop-shadow-xl">{currentOutput}</p>
                      <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest mt-2 block opacity-70">GEMINI</span>
                    </div>
                  </div>

                  <div className={`flex-1 flex flex-col items-end transition-all duration-500 ${currentInput ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    <div className="glass-subtitle px-6 py-4 rounded-3xl max-w-lg border-r-4 border-zinc-500/80 text-right">
                      <p className="text-zinc-100 text-lg font-medium leading-relaxed drop-shadow-xl">{currentInput}</p>
                      <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mt-2 block opacity-70">YOU</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {status !== AppStatus.CONNECTED && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-12 z-50">
                <div className="mb-8 p-10 rounded-full bg-blue-500/5 border border-white/5">
                  <svg className="w-16 h-16 text-blue-500 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold mb-4 tracking-tight text-zinc-300">System Ready</h2>
                <p className="text-zinc-600 max-w-xs text-[11px] font-bold uppercase tracking-widest leading-loose">Connect to establish neural visualization link.</p>
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="glass p-6 rounded-[2.5rem] border-white/5 flex flex-col md:flex-row gap-6">
            <div className="flex-1 space-y-2">
              <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-2">Voice Synthetic</label>
              <select 
                value={config.voiceName}
                disabled={status !== AppStatus.IDLE}
                onChange={(e) => setConfig(prev => ({ ...prev, voiceName: e.target.value as any }))}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 outline-none focus:ring-2 ring-blue-500/40 transition-all text-sm font-bold appearance-none cursor-pointer"
              >
                <option value="Zephyr">Zephyr (Default)</option>
                <option value="Puck">Puck (Fast)</option>
                <option value="Charon">Charon (Deep)</option>
                <option value="Kore">Kore (Soft)</option>
                <option value="Fenrir">Fenrir (Strong)</option>
              </select>
            </div>
            <div className="flex-1 space-y-2">
              <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-2">Manual Directive</label>
              <input 
                type="text"
                placeholder="Command input..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 outline-none focus:ring-2 ring-blue-500/40 transition-all text-sm font-bold"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && status === AppStatus.CONNECTED) {
                    sessionRef.current?.sendRealtimeInput({ text: (e.target as HTMLInputElement).value });
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
            </div>
          </div>
        </div>

        <div className="xl:col-span-4 flex flex-col min-h-0 h-full overflow-hidden">
          <div className="flex-1 glass rounded-[2.5rem] border-white/5 overflow-hidden flex flex-col shadow-2xl">
            <div className="p-6 bg-white/5 border-b border-white/5 flex items-center justify-between">
              <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${isAiTalking ? 'bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.6)]' : 'bg-zinc-700'}`} />
                Link_History
              </span>
              <button onClick={() => setTranscriptions([])} className="text-[10px] text-zinc-600 hover:text-white transition-colors uppercase font-black">Clear</button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-hide text-zinc-300">
              {transcriptions.map((item, idx) => (
                <div key={idx} className={`flex flex-col ${item.type === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[90%] px-5 py-4 rounded-3xl text-sm font-bold shadow-lg ${
                    item.type === 'user' 
                      ? 'bg-blue-600 text-white border border-blue-500/20' 
                      : 'bg-zinc-900/50 text-zinc-200 border border-white/5'
                  }`}>
                    {item.text}
                  </div>
                  <span className="text-[8px] text-zinc-700 mt-2 uppercase font-black tracking-[0.2em] mx-2">
                    {item.type === 'user' ? 'USER_ID' : 'GEN_CORE'}
                  </span>
                </div>
              ))}
            </div>
            
            {errorMessage && (
              <div className="m-6 p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-3">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
                {errorMessage}
              </div>
            )}
          </div>
          
          <div className="mt-6 p-6 glass rounded-[2rem] border-white/5 flex items-center gap-5 group">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${isAiTalking ? 'bg-blue-600 shadow-blue-500/30 text-white' : 'bg-white/5 text-zinc-600'}`}>
               <svg className={`w-7 h-7 ${isAiTalking ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ transform: (!isAiTalking && !isMuted) ? `scale(${1 + micLevel / 100})` : 'scale(1)' }}>
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
               </svg>
            </div>
            <div>
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Status Overview</p>
              <p className="text-[11px] text-white font-bold leading-tight uppercase italic">
                {isAiTalking ? 'Bio-Link Decoding...' : isMuted ? 'Mic Deactivated' : 'Neural Listening...'}
              </p>
            </div>
          </div>
        </div>
      </main>
      
      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .glass { background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(50px); }
        .glass-subtitle { 
          background: rgba(0, 0, 0, 0.65); 
          backdrop-filter: blur(30px); 
          border: 1px solid rgba(255, 255, 255, 0.1); 
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
        }
      `}</style>
    </div>
  );
};

export default App;
