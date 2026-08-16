import { GoogleGenAI } from "@google/genai";
async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = ["gemini-2.5-flash", "gemini-2.5-flash-native-audio", "gemini-2.5-flash-native-audio-latest", "gemini-2.5-flash-13b"];
  for (const model of models) {
    try {
      const session = await ai.live.connect({ model });
      console.log(model, "success");
      session.close();
      return;
    } catch (e) {
      console.log(model, "failed", e.message);
    }
  }
}
run();
