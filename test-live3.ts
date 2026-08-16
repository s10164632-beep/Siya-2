import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
config();
async function run() {
  const ai = new GoogleGenAI({});
  const models = [
    "gemini-2.0-flash-exp", 
    "gemini-2.0-flash", 
    "gemini-2.5-flash",
    "gemini-3.1-flash-live-preview",
    "gemini-2.5-flash-native-audio",
    "gemini-3.1-flash-native-audio",
    "gemini-2.0-flash-live-preview-04-09",
    "gemini-2.0-flash-exp"
  ];
  for (const model of models) {
    try {
      console.log("trying", model);
      const session = await ai.live.connect({ model });
      console.log(model, "success");
      session.close();
      return;
    } catch (e: any) {
      console.log(model, "failed", e.message);
    }
  }
}
run();
