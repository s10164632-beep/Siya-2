import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
config();
async function run() {
  const ai = new GoogleGenAI({});
  try {
    const models = await ai.models.list();
    for await (const m of models) {
      if (m.name.includes("live") || m.name.includes("omni") || m.name.includes("native") || m.name.includes("flash") || m.supportedGenerationMethods?.includes("bidiGenerateContent")) {
        console.log(m.name, m.supportedGenerationMethods);
      }
    }
  } catch (e: any) {
    console.error(e.message);
  }
}
run();
