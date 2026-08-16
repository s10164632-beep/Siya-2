import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
config();
async function run() {
  const ai = new GoogleGenAI({});
  try {
    const models = await ai.models.list();
    for await (const m of models) {
      if (m.name.includes("gemini-3.1-flash-live-preview") || m.name.includes("gemini-2.0-flash-exp")) {
        console.log(m);
      }
    }
  } catch (e: any) {
    console.error(e.message);
  }
}
run();
