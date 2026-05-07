import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../.env.local' });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test(model: string) {
  try {
    const r = await ai.models.generateContent({ model, contents: 'hi' });
    console.log(`SUCCESS ${model}:`, r.text?.slice(0, 10));
  } catch(e: any) {
    console.log(`ERROR ${model}:`, e.message);
  }
}
test('gemini-2.5-pro');
test('gemini-2.5-flash-lite');
test('gemini-flash-latest');
