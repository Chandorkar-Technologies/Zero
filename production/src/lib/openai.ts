import { createOpenAI } from '@ai-sdk/openai';
import { env } from '../env';

// Cloudflare Workers-compatible OpenAI client
// The default `openai` export from @ai-sdk/openai looks for process.env.OPENAI_API_KEY
// which doesn't exist in Cloudflare Workers. We need to use createOpenAI and pass the
// API key explicitly from the Cloudflare environment.
export const getOpenAI = () => {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return createOpenAI({
    apiKey: env.OPENAI_API_KEY,
  });
};

// Helper to get a model instance
export const openai = (model: string) => {
  return getOpenAI()(model);
};
