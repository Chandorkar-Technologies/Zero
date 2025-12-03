import { ReSummarizeThread, SummarizeMessage, SummarizeThread } from './brain.fallback.prompts';
import { getSubscriptionFactory } from './factories/subscription-factory.registry';
import { AiChatPrompt, StyledEmailAssistantSystemPrompt } from './prompts';
import { EPrompts, EProviders } from '../types';
import { getPromptName } from '../pipelines';
import { env } from '../env';

export const enableBrainFunction = async (connection: { id: string; providerId: EProviders }) => {
  try {
    const subscriptionFactory = getSubscriptionFactory(connection.providerId);
    await subscriptionFactory.subscribe({ body: { connectionId: connection.id } });
  } catch (error) {
    // Log the error but DON'T reset the connection
    // Resetting tokens because subscription setup failed is too aggressive
    // The connection might still be usable for email operations even without subscriptions
    console.error(`[enableBrainFunction] Failed for connection ${connection.id}:`, error);

    // Only log, don't reset - let the user keep their connection
    // Subscriptions are for real-time notifications, not core email functionality
  }
};

export const disableBrainFunction = async (connection: { id: string; providerId: EProviders }) => {
  try {
    const subscriptionFactory = getSubscriptionFactory(connection.providerId);
    await subscriptionFactory.unsubscribe({
      body: { connectionId: connection.id, providerId: connection.providerId },
    });
  } catch (error) {
    console.error(`Failed to disable brain function: ${error}`);
  }
};

export const getPrompt = async (promptName: string, fallback: string) => {
  const existingPrompt = await env.prompts_storage.get(promptName);
  if (!existingPrompt || existingPrompt === 'undefined') {
    await env.prompts_storage.put(promptName, fallback);
    return fallback;
  }
  return existingPrompt;
};

export const getPrompts = async ({ connectionId }: { connectionId: string }) => {
  const prompts: Record<EPrompts, string> = {
    [EPrompts.SummarizeMessage]: '',
    [EPrompts.ReSummarizeThread]: '',
    [EPrompts.SummarizeThread]: '',
    [EPrompts.Chat]: '',
    [EPrompts.Compose]: '',
    // [EPrompts.ThreadLabels]: '',
  };
  const fallbackPrompts = {
    [EPrompts.SummarizeMessage]: SummarizeMessage,
    [EPrompts.ReSummarizeThread]: ReSummarizeThread,
    [EPrompts.SummarizeThread]: SummarizeThread,
    [EPrompts.Chat]: AiChatPrompt(),
    [EPrompts.Compose]: StyledEmailAssistantSystemPrompt(),
    // [EPrompts.ThreadLabels]: '',
  };
  for (const promptType of Object.values(EPrompts)) {
    const promptName = getPromptName(connectionId, promptType);
    const prompt = await getPrompt(promptName, fallbackPrompts[promptType]);
    prompts[promptType] = prompt;
  }
  return prompts;
};
