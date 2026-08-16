import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";
config();
async function run() {
  const ai = new GoogleGenAI({ httpOptions: { apiVersion: "v1alpha" } });
  const models = [
    "gemini-2.0-flash-exp", 
    "gemini-2.0-flash", 
    "gemini-2.5-flash",
  ];
  for (const model of models) {
    try {
      console.log("trying", model);
      const session = await ai.live.connect({ model });
      console.log(model, "success");
      session.close();
    } catch (e: any) {
      console.log(model, "failed", e.message);
    }
  }
}
run();
