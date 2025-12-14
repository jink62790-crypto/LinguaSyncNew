import { GoogleGenAI, Type, Modality } from "@google/genai";
import { TranscriptionResponse, WordDefinition, PronunciationScore, TranscriptionSegment } from "../types";

// Fix for "Cannot find name 'process'" in TypeScript without node types
declare const process: {
  env: {
    API_KEY?: string;
    DEEPSEEK_API_KEY?: string;
    [key: string]: string | undefined;
  }
};

const TRANSCRIPTION_MODEL = "gemini-2.5-flash"; 
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

/**
 * Lazy initialization of the AI client.
 */
const getAi = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please check your deployment environment variables.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Helper to retry async functions (e.g., API calls)
 */
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      // Retry on 5xx server errors or "internal error" messages
      const isInternalError = error.message?.toLowerCase().includes("internal error") || 
                              error.message?.includes("500") || 
                              error.message?.includes("503");
      
      if (isInternalError && i < retries - 1) {
        console.warn(`API call failed (attempt ${i + 1}/${retries}). Retrying in ${delayMs}ms...`, error);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

/**
 * DeepSeek Client Helper
 */
const callDeepSeek = async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const deepSeekKey = process.env.DEEPSEEK_API_KEY;
    if (!deepSeekKey) {
        throw new Error("DeepSeek API Key is missing");
    }

    console.log("[Fallback] Switching to DeepSeek API...");

    const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${deepSeekKey}`
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            stream: false,
            response_format: { type: 'json_object' } // DeepSeek supports JSON mode
        })
    });

    if (!response.ok) {
        throw new Error(`DeepSeek API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
};

/**
 * Converts a File/Blob to Base64 string (without Data URI prefix).
 */
const fileToBase64 = async (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Post-processes segments to merge short "filler" segments.
 */
const mergeShortSegments = (segments: TranscriptionSegment[]): TranscriptionSegment[] => {
  const MIN_WORDS = 4;
  const merged: TranscriptionSegment[] = [];
  
  if (segments.length === 0) return [];

  let current = segments[0];

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    const currentWordCount = current.text.split(/\s+/).length;
    const duration = current.end - current.start;

    if (currentWordCount < MIN_WORDS && duration < 2.0) {
      current = {
        ...current,
        end: next.end,
        text: `${current.text} ${next.text}`,
        translation: `${current.translation} ${next.translation}`,
        idiomatic: next.idiomatic || current.idiomatic,
        idiomExplanation: next.idiomExplanation || current.idiomExplanation,
      };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
};

/**
 * Helper to parse JSON that might be wrapped in Markdown code blocks
 */
const cleanAndParseJson = <T>(text: string): T => {
    try {
        // Remove ```json and ``` wrap if present
        const cleanText = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        return JSON.parse(cleanText) as T;
    } catch (e) {
        console.error("JSON Parse Error on text:", text);
        throw new Error("Failed to parse AI response. Ensure content is valid JSON.");
    }
};

/**
 * Helper to correct MIME types for mobile devices.
 * Mobile browsers often report "" or "application/octet-stream".
 * We must guess based on extension to make Gemini happy.
 */
const getCorrectMimeType = (file: File): string => {
    const knownMimeTypes: Record<string, string> = {
        'mp3': 'audio/mp3',
        'wav': 'audio/wav',
        'flac': 'audio/flac',
        'm4a': 'audio/mp4', // Gemini treats m4a as audio/mp4 container
        'aac': 'audio/aac',
        'ogg': 'audio/ogg',
        'oga': 'audio/ogg',
        'webm': 'audio/webm',
        'mp4': 'audio/mp4',
    };

    // If browser gives a specific audio/video type, trust it
    if (file.type && (file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
        return file.type;
    }

    // Otherwise, guess from extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && knownMimeTypes[ext]) {
        return knownMimeTypes[ext];
    }

    // Last resort fallback
    return 'audio/mp3';
};

/**
 * Transcribes audio with Translation and Idiomatic Expressions.
 * NOTE: Strictly requires Gemini (Multimodal). DeepSeek cannot handle audio files.
 */
export const transcribeAudio = async (file: File): Promise<TranscriptionResponse> => {
  const base64Audio = await fileToBase64(file);
  const mimeType = getCorrectMimeType(file);

  console.log(`Uploading file: ${file.name}, Detected MIME: ${mimeType} (Original: ${file.type})`);

  // Optimized System Prompt:
  // Now requests a REWRITE ("idiomatic") instead of just an idiom tag.
  const systemPrompt = `
    Role: English Coach.
    Task: Transcribe audio (en-US), merge fillers, and improve the user's English.
    IMPORTANT: Return strict JSON only. Escape all double quotes inside strings.
    Output JSON ONLY:
    {
      "language": "en-US",
      "meta": { "wordCount": number, "estimatedLevel": "string", "speed": "string" },
      "segments": [
        {
          "start": number, "end": number,
          "text": "Original text (combine short phrases)",
          "translation": "Chinese translation",
          "idiomatic": "Rewrite the original text to sound like a native American speaker (natural, colloquial or professional as appropriate).",
          "idiomExplanation": "Brief Chinese explanation of the improvement (e.g. better word choice)."
        }
      ]
    }
  `;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      language: { type: Type.STRING },
      meta: {
        type: Type.OBJECT,
        properties: {
            wordCount: { type: Type.NUMBER },
            estimatedLevel: { type: Type.STRING },
            speed: { type: Type.STRING }
        }
      },
      segments: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            start: { type: Type.NUMBER },
            end: { type: Type.NUMBER },
            text: { type: Type.STRING },
            translation: { type: Type.STRING },
            idiomatic: { type: Type.STRING },
            idiomExplanation: { type: Type.STRING },
          },
          required: ["start", "end", "text", "translation", "idiomatic", "idiomExplanation"],
        },
      },
    },
    required: ["language", "segments", "meta"],
  };

  return withRetry(async () => {
    const response = await getAi().models.generateContent({
      model: TRANSCRIPTION_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType, // Use the corrected MIME type
              data: base64Audio
            }
          },
          { text: "Generate JSON." }
        ]
      },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        maxOutputTokens: 8192, // Increase limit to prevent truncated JSON
      }
    });

    if (response.text) {
      // Use helper to handle markdown wrapping or simple cleanups
      const parsed = cleanAndParseJson<TranscriptionResponse>(response.text);
      parsed.segments = mergeShortSegments(parsed.segments);
      return parsed;
    }
    throw new Error("Empty response from Gemini");
  });
};

/**
 * Text-to-Speech.
 * NOTE: Strictly requires Gemini (Multimodal).
 */
export const generateSpeech = async (text: string): Promise<string> => {
  return withRetry(async () => {
    const response = await getAi().models.generateContent({
      model: TTS_MODEL,
      contents: { parts: [{ text }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }, 
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (audioData) return audioData;
    throw new Error("No audio data returned");
  });
};

/**
 * Scores user pronunciation.
 * NOTE: Strictly requires Gemini (Multimodal) to listen to user audio.
 */
export const scorePronunciation = async (userAudio: Blob, referenceText: string): Promise<PronunciationScore> => {
  const base64Audio = await fileToBase64(userAudio);
  
  // AudioRecorder produces audio/webm, which Gemini handles well.
  // But just in case, we can explicitely set it.
  const mimeType = 'audio/webm';

  const prompt = `
    Listen to this user recording and compare it to the text: "${referenceText}".
    Grade the pronunciation accuracy from 0 to 100.
    Provide brief feedback.
    Return JSON: { score: number, feedback: string, accuracy: 'good'|'average'|'poor' }
  `;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      score: { type: Type.NUMBER },
      feedback: { type: Type.STRING },
      accuracy: { type: Type.STRING, enum: ['good', 'average', 'poor'] }
    },
    required: ["score", "feedback", "accuracy"]
  };

  return withRetry(async () => {
    const response = await getAi().models.generateContent({
      model: TRANSCRIPTION_MODEL,
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Audio } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    if (response.text) {
      // Use cleanAndParseJson for consistency
      return cleanAndParseJson<PronunciationScore>(response.text);
    }
    throw new Error("Scoring failed");
  });
};

/**
 * Get Word Definition.
 * STRATEGY: Try Gemini -> Fail -> Try DeepSeek.
 */
export const getWordDefinition = async (word: string, contextSentence: string): Promise<WordDefinition> => {
  const prompt = `Define "${word}" in context: "${contextSentence}". Return JSON with: word, definition (English), example, phonetic.`;
  
  // 1. Try Google Gemini First
  try {
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
        word: { type: Type.STRING },
        definition: { type: Type.STRING },
        example: { type: Type.STRING },
        phonetic: { type: Type.STRING },
        },
        required: ["word", "definition", "example"],
    };

    return await withRetry(async () => {
        const response = await getAi().models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema }
        });
        // Use cleanAndParseJson for consistency
        return cleanAndParseJson<WordDefinition>(response.text!);
    });
    
  } catch (geminiError) {
      console.warn("Gemini definition failed, attempting DeepSeek fallback...", geminiError);
      
      // 2. Fallback to DeepSeek if configured
      if (process.env.DEEPSEEK_API_KEY) {
          try {
              const systemPrompt = "You are an English dictionary API. Output purely JSON.";
              const responseText = await callDeepSeek(systemPrompt, prompt);
              return cleanAndParseJson<WordDefinition>(responseText);
          } catch (deepSeekError) {
              console.error("DeepSeek fallback also failed:", deepSeekError);
              throw deepSeekError; // Throw the DeepSeek error if both fail
          }
      }
      
      throw geminiError; // If no DeepSeek key, throw original error
  }
};