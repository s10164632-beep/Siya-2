import { GoogleGenAI } from "@google/genai";
import { getApiKey } from "./configService";
import { PersonalityMode, getSystemInstruction } from "./personalityService";

let chatSession: any = null;
let currentMode: PersonalityMode | null = null;

export function resetSiaSession() {
  chatSession = null;
  currentMode = null;
}

export async function getSiaResponse(prompt: string, history: { sender: "user" | "siya", text: string }[] = [], mode: PersonalityMode = "Sassy"): Promise<string> {
  try {
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    
    if (!chatSession || currentMode !== mode) {
      currentMode = mode;
      
      // SLIDING WINDOW MEMORY: Keep only the last 20 messages to prevent "buffer full" (context window overflow)
      const recentHistory = history.slice(-20);
      
      let formattedHistory: any[] = [];
      let currentRole = "";
      let currentText = "";

      for (const msg of recentHistory) {
        const role = msg.sender === "user" ? "user" : "model";
        if (role === currentRole) {
          currentText += "\n" + msg.text;
        } else {
          if (currentRole !== "") {
            formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
          }
          currentRole = role;
          currentText = msg.text;
        }
      }
      if (currentRole !== "") {
        formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
      }

      if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
        formattedHistory.shift();
      }

      chatSession = ai.chats.create({
        model: "gemini-3.1-flash-lite-preview",
        config: {
          systemInstruction: getSystemInstruction(mode),
        },
        history: formattedHistory,
      });
    }

    const response = await chatSession.sendMessage({ message: prompt });
    return response.text || "Ugh, fine. I have nothing to say.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Uff, mera dimaag kharab ho gaya hai. Try again later, Shivam Yadav.";
  }
}

export async function getSiaAudio(text: string): Promise<string | null> {
  try {
    const cleanText = text.replace(/\[.*?\]/g, "").trim();
    const apiKey = await getApiKey();
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: cleanText }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}

