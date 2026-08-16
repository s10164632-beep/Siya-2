import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
config();
async function run() {
  const ai = new GoogleGenAI({});
  console.log("using key length:", process.env.GEMINI_API_KEY?.length);
  const models = ["gemini-2.5-flash", "gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-latest"];
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
