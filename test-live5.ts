import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
config();
async function run() {
  const ai = new GoogleGenAI({});
  try {
    const models = await ai.models.list();
    for await (const m of models) {
      if (m.supportedMethods?.includes("bidiGenerateContent")) {
        console.log(m.name, "supports bidiGenerateContent");
      }
    }
  } catch (e: any) {
    console.error(e.message);
  }
}
run();
