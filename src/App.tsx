import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, X, Settings2 } from "lucide-react";
import { getSiaResponse, getSiaAudio, resetSiaSession as resetSiyaSession } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import { playPCM } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";
import { PersonalityMode } from "./services/personalityService";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "siya";
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [expression, setExpression] = useState<string>("smile");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("siya_chat_history");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse chat history", e);
      }
    }
    return [];
  });
  const messagesRef = useRef(messages);
  const [personalityMode, setPersonalityMode] = useState<PersonalityMode>(() => {
    return (localStorage.getItem("siya_personality_mode") as PersonalityMode) || "Sassy";
  });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    messagesRef.current = messages;
    localStorage.setItem("siya_chat_history", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem("siya_personality_mode", personalityMode);
    resetSiyaSession();
  }, [personalityMode]);

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  const extractExpression = (text: string) => {
    const matches = text.match(/\[(.*?)\]/g);
    if (matches && matches.length > 0) {
      const lastTag = matches[matches.length - 1];
      return lastTag.replace('[', '').replace(']', '').trim();
    }
    return null;
  };

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      setAppState("idle");
      return;
    }

    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "user", text: finalTranscript }]);
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      responseText = commandResult.action;
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-s", sender: "siya", text: responseText }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getSiaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }

      setAppState("idle");

      setTimeout(() => {
        if (commandResult.url) {
          window.open(commandResult.url, "_blank");
        }
      }, 1500);
    } else {
      // 2. General Chit-Chat via Gemini
      responseText = await getSiaResponse(finalTranscript, messagesRef.current, personalityMode);
      
      const newExpr = extractExpression(responseText);
      if (newExpr) setExpression(newExpr);

      setMessages((prev) => [...prev, { id: Date.now().toString() + "-s", sender: "siya", text: responseText }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getSiaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }
      setAppState("idle");
    }
  }, [isMuted, isSessionActive, personalityMode]);

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = async () => {
    if (isSessionActive) {
      setIsSessionActive(false);
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setAppState("idle");
      resetSiyaSession();
    } else {
      try {
        setIsSessionActive(true);
        resetSiyaSession();
        
        const session = new LiveSessionManager(personalityMode);
        session.isMuted = isMuted;
        liveSessionRef.current = session;
        
        session.onStateChange = (state) => {
          setAppState(state);
          if (state === "idle") {
            setIsSessionActive(false);
          }
        };

        session.onError = (message) => {
          setMessages((prev) => [...prev, { id: Date.now().toString() + "-error", sender: "siya", text: `[Error: ${message}]` }]);
        };

        session.onMessage = (sender, text) => {
          setMessages((prev) => [...prev, { id: Date.now().toString() + "-" + sender, sender, text }]);
          if (sender === "siya") {
            const expr = extractExpression(text);
            if (expr) setExpression(expr);
          }
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        await session.start();
      } catch (e: any) {
        if (e?.message === "Permission denied" || e?.name === "NotAllowedError") {
          console.warn("Microphone permission denied by user.");
          setShowPermissionModal(true);
        } else {
          console.error("Failed to start session", e);
          setMessages((prev) => [...prev, { id: Date.now().toString() + "-error", sender: "siya", text: `[System: Failed to connect to server. ${e?.message || ''}]` }]);
        }
        setIsSessionActive(false);
        setAppState("idle");
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    
    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)} 
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-900/20 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-start z-20 shrink-0 px-6 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3 mt-1">
          <div className="flex flex-col">
            <h1 className="text-2xl font-serif font-bold tracking-widest opacity-90 leading-tight uppercase bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">SIYA</h1>
            <span className="text-[10px] text-white/50 tracking-wider uppercase font-medium">Developed by Shivam Yadav</span>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-full transition-colors border border-white/10 ${showSettings ? 'bg-white/20 text-white' : 'bg-white/5 hover:bg-white/10'}`}
              title="Settings"
            >
              <Settings2 size={18} className="opacity-70" />
            </button>

            {messages.length > 0 && (
              <button
                onClick={() => {
                  if (confirm("Are you sure you want to clear the chat history?")) {
                    setMessages([]);
                    resetSiyaSession();
                  }
                }}
                className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/10"
                title="Clear Chat History"
              >
                <Trash2 size={18} className="opacity-70" />
              </button>
            )}
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? (
                <VolumeX size={18} className="opacity-70" />
              ) : (
                <Volume2 size={18} className="opacity-70" />
              )}
            </button>
          </div>

          <AnimatePresence>
            {showSettings && (
              <motion.div 
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="mt-2 bg-[#121212] border border-white/10 p-2 rounded-2xl shadow-2xl flex flex-col gap-1 w-48 backdrop-blur-xl"
              >
                <div className="px-3 py-1.5 text-xs text-white/40 uppercase tracking-wider font-semibold">Mode</div>
                {(["Sassy"] as PersonalityMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setPersonalityMode(mode);
                      setShowSettings(false);
                      // If active, tell the user they need to restart the session
                      if (isSessionActive) {
                        alert("Mode changed. Please end and restart the session to apply.");
                      }
                    }}
                    className={`text-left px-3 py-2 rounded-xl text-sm transition-colors ${
                      personalityMode === mode 
                        ? "bg-violet-600/30 text-violet-300 font-medium border border-violet-500/30" 
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* Main Content - Visualizer & Chat */}
      <main className="absolute inset-0 flex flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-20 pb-24 px-4 md:px-12 pointer-events-none">
        
        {/* Left Column: Siya Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6">
            <AnimatePresence>
              {appState === "processing" && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                >
                  <Loader2 size={16} className="animate-spin" />
                  Replying...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center Visualizer (Fixed Full Screen Background) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} expression={expression} />
        </div>

        {/* Right Column: User Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10 pointer-events-auto">
          <div className="h-6 flex justify-end">
            <AnimatePresence>
              {appState === "listening" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 text-violet-300/80 text-sm md:text-base italic"
                >
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                  Listening...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Controls */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-6 md:pb-8 z-20 shrink-0 gap-4">
        <AnimatePresence>
          {showTextInput && (
            <motion.form 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl"
            >
              <input 
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type a message to Siya..."
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                autoFocus
              />
              <button 
                type="submit"
                disabled={!textInput.trim()}
                className="p-2 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 transition-colors"
              >
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-medium tracking-wide transition-all duration-300 shadow-2xl
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                  : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <Mic size={20} className="group-hover:animate-bounce" />
                <span>Start Session</span>
              </>
            )}
          </button>
          
          {!isSessionActive && (
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shadow-2xl"
              title="Type instead"
            >
              <Keyboard size={20} className="opacity-70" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
