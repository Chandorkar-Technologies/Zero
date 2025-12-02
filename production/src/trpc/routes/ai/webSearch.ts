import { activeDriverProcedure } from '../../trpc';
import { createPerplexity } from '@ai-sdk/perplexity';
import { generateText } from 'ai';
import { env } from '../../../env';
import { z } from 'zod';

export const webSearch = activeDriverProcedure
  .input(z.object({ query: z.string() }))
  .mutation(async ({ input }) => {
    const perplexity = createPerplexity({
      apiKey: env.PERPLEXITY_API_KEY,
    });
    const result = await generateText({
      model: perplexity('sonar'),
      system:
        'You are a helpful assistant that can search the web for information. NEVER include sources or sources references in your response. NEVER use markdown formatting in your response.',
      messages: [{ role: 'user', content: input.query }],
      maxTokens: 1024,
    });
    return result;
  });
