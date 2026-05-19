import type { ProviderDefinition } from '../types';

export const openaiProvider: ProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  description: 'Generate content, summarize, analyze sentiment, draft emails',
  category: 'ai',
  icon: 'Brain',
  docsUrl: 'https://platform.openai.com/docs/api-reference',
  configFields: [
    { key: 'api_key', label: 'API Key', type: 'string', required: true, placeholder: 'sk-...' },
    { key: 'model', label: 'Model', type: 'select', required: true, options: [
      { label: 'GPT-4o', value: 'gpt-4o' },
      { label: 'GPT-4o-mini', value: 'gpt-4o-mini' },
      { label: 'GPT-4-turbo', value: 'gpt-4-turbo' },
    ]},
  ],
  capabilities: [
    { action: 'generate', label: 'Generate Content', description: 'Generate text using AI',
      inputFields: [
        { key: 'prompt', label: 'Prompt', type: 'string', required: true },
        { key: 'temperature', label: 'Temperature', type: 'number' },
      ]},
    { action: 'summarize', label: 'Summarize', description: 'Summarize text',
      inputFields: [
        { key: 'text', label: 'Text', type: 'string', required: true },
      ]},
    { action: 'draft_email', label: 'Draft Email', description: 'AI-drafted email reply',
      inputFields: [
        { key: 'context', label: 'Conversation Context', type: 'string', required: true },
        { key: 'tone', label: 'Tone', type: 'select', options: [
          { label: 'Professional', value: 'professional' },
          { label: 'Friendly', value: 'friendly' },
          { label: 'Formal', value: 'formal' },
        ]},
      ]},
  ],
  defaultBaseUrl: 'https://api.openai.com/v1',
  builtIn: true,
};
