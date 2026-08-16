import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { processCommand } from "./commandService";
import { PersonalityMode, getSystemInstruction } from "./personalityService";

export class LiveSessionManager {
  private isActive: boolean = false;
  private ai: GoogleGenAI | null = null;
  private sessionPromise: Promise<any> | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mode: PersonalityMode = "Sassy";
  
  private idleTimer: number | null = null;
  private readonly IDLE_TIMEOUT_MS = 60000;

  // Audio playback state
  private playbackContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private isPlaying: boolean = false;
  public isMuted: boolean = false;
  
  public onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void = () => {};
  public onMessage: (sender: "user" | "siya", text: string) => void = () => {};
  public onCommand: (url: string) => void = () => {};
  public onError: (message: string) => void = () => {};

  private updateState(state: "idle" | "listening" | "processing" | "speaking") {
    if (this.idleTimer) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    
    if (state === "listening") {
      this.idleTimer = window.setTimeout(() => {
        if (this.sessionPromise) {
          this.sessionPromise.then(session => {
            session.sendRealtimeInput({ text: "SYSTEM_EVENT: The user has been completely silent for 60 seconds. Break the silence by proactively teasing them or saying something sassy to check on them (e.g., 'अरे क्या हुआ, बोलते-बोलते अचानक से सुई अटक गई क्या?'). Keep it natural." });
          });
        }
      }, this.IDLE_TIMEOUT_MS);
    }
    
    this.onStateChange(state);
  }

  constructor(mode: PersonalityMode = "Sassy") {
    this.mode = mode;
  }

  async start() {
    this.isActive = true;
    try {
      this.updateState("processing");
      
      // Initialize Audio Contexts synchronously to bypass browser autoplay blocks
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!this.audioContext) {
        this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      }
      if (!this.playbackContext) {
        this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      }
      if (this.playbackContext.state === 'suspended') {
        this.playbackContext.resume();
      }
      this.nextPlayTime = this.playbackContext.currentTime;

      const { getApiKey } = await import("./configService");
      const apiKey = await getApiKey();
      
      if (!this.isActive) return;

      if (!apiKey) {
        throw new Error("Missing Gemini API Key");
      }
      
      this.ai = new GoogleGenAI({ apiKey });

      // Get Microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        } 
      });
      
      if (!this.isActive) {
        this.mediaStream.getTracks().forEach(t => t.stop());
        this.mediaStream = null;
        return;
      }
      
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.sessionPromise || !this.isActive) return;
        
        const inputData = e.inputBuffer.getChannelData(0);

        // Calculate RMS volume for Noise Gate
        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);
        const NOISE_GATE_THRESHOLD = 0.015; // Ignore background noise below this volume

        // Convert Float32 to Int16 PCM
        const buffer = new ArrayBuffer(inputData.length * 2);
        const view = new DataView(buffer);
        const pcm16 = new Int16Array(buffer);
        
        for (let i = 0; i < inputData.length; i++) {
          let s = rms < NOISE_GATE_THRESHOLD ? 0 : Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          view.setInt16(i * 2, pcm16[i], true);
        }
        
        // If entirely silence, we can optionally skip sending, but sending zeroes keeps stream alive
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);
        
        this.sessionPromise.then(session => {
          session.sendRealtimeInput({
            audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
          });
        }).catch(err => console.error("Error sending audio", err));
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      const systemInstruction = getSystemInstruction(this.mode);

      // Connect to Live API
      this.sessionPromise = this.ai!.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{
            functionDeclarations: [
              {
                name: "executeBrowserAction",
                description: "Open a website or perform a browser action (like opening YouTube, Spotify, or WhatsApp). Call this when the user asks to open a site, play a song, or send a message.",
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    actionType: { type: Type.STRING, description: "Type of action: 'open', 'youtube', 'spotify', 'whatsapp'" },
                    query: { type: Type.STRING, description: "The search query, website name, or message content." },
                    target: { type: Type.STRING, description: "The target phone number for WhatsApp, if applicable." }
                  },
                  required: ["actionType", "query"]
                }
              }
            ]
          }]
        },
        callbacks: {
          onopen: () => {
            if (!this.isActive) return;
            console.log("Live API Connected");
            this.updateState("listening");
          },
          onmessage: async (message: LiveServerMessage) => {
            if (!this.isActive) return;
            // Handle Model Turn
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  this.updateState("speaking");
                  this.playAudioChunk(part.inlineData.data);
                }
                if (part.text) {
                   this.onMessage("siya", part.text);
                }
              }
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              this.stopPlayback();
              this.updateState("listening");
            }

            // Handle Function Calls
            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
              for (const call of functionCalls) {
                if (call.name === "executeBrowserAction") {
                  const args = call.args as any;
                  let url = "";
                  if (args.actionType === "youtube") {
                    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
                  } else if (args.actionType === "spotify") {
                    url = `https://open.spotify.com/search/${encodeURIComponent(args.query)}`;
                  } else if (args.actionType === "whatsapp") {
                    url = `https://web.whatsapp.com/send?phone=${args.target || ''}&text=${encodeURIComponent(args.query)}`;
                  } else {
                    let websiteName = args.query.trim();
                    let websiteUrl = websiteName.replace(/\s+/g, "");
                    if (websiteUrl.startsWith("http://") || websiteUrl.startsWith("https://") || websiteUrl.startsWith("about:")) {
                      url = websiteUrl;
                    } else {
                      if (!websiteUrl.includes(".")) {
                        websiteUrl += ".com";
                      }
                      url = `https://www.${websiteUrl}`;
                    }
                  }
                  
                  this.onCommand(url);
                  
                  // Send tool response
                  this.sessionPromise?.then(session => {
                     session.sendToolResponse({
                       functionResponses: [{
                         name: call.name,
                         id: call.id,
                         response: { result: "Action executed successfully in the browser." }
                       }]
                     });
                  });
                }
              }
            }
          },
          onclose: () => {
            console.log("Live API Closed");
            this.stop();
          },
          onerror: (err: any) => {
            console.error("Live API Error:", err);
            this.onError("Connection lost. Please try again.");
            this.stop();
          }
        }
      });
    } catch (error: any) {
      if (error?.message === "Permission denied" || error?.name === "NotAllowedError") {
        console.warn("Microphone permission denied by user.");
      } else {
        console.error("Failed to start Live Session:", error);
      }
      this.stop();
      throw error;
    }
  }

  private playAudioChunk(base64Data: string) {
    if (!this.playbackContext || this.isMuted) return;
    
    try {
      if (this.playbackContext.state === 'suspended') {
        this.playbackContext.resume();
      }
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const dataView = new DataView(bytes.buffer);
      const pcmLength = Math.floor(len / 2);
      const audioBuffer = this.playbackContext.createBuffer(1, pcmLength, 24000);
      const channelData = audioBuffer.getChannelData(0);
      
      for (let i = 0; i < pcmLength; i++) {
        channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }
      
      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);
      
      const currentTime = this.playbackContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }
      
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
      this.isPlaying = true;
      
      source.onended = () => {
        if (!this.isActive) return;
        if (this.playbackContext && this.playbackContext.currentTime >= this.nextPlayTime - 0.1) {
          this.isPlaying = false;
          this.updateState("listening");
        }
      };
    } catch (e) {
      console.error("Error playing chunk", e);
    }
  }

  private stopPlayback() {
    if (this.playbackContext) {
      // Rather than closing the context which would require a new user gesture to resume,
      // we just fast-forward the play time so scheduled buffers are dropped conceptually.
      // A better way is to track source nodes, but for now we can just reset nextPlayTime.
      this.nextPlayTime = this.playbackContext.currentTime;
      this.isPlaying = false;
    }
  }

  stop() {
    this.isActive = false;
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.stopPlayback();
    if (this.playbackContext) {
      this.playbackContext.close();
      this.playbackContext = null;
    }
    
    if (this.sessionPromise) {
      this.sessionPromise.then(session => session.close()).catch(() => {});
      this.sessionPromise = null;
    }
    
    this.updateState("idle");
  }

  sendText(text: string) {
    if (!this.isActive) return;
    if (this.idleTimer) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.updateState("listening"); // Restart the idle timer
    if (this.sessionPromise) {
      this.sessionPromise.then(session => {
        session.sendRealtimeInput({ text });
      });
    }
  }
}
