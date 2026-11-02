import type { OpenRouterModel } from '../../src/openrouter.ts'

/**
 * Trimmed slice of a real authenticated OpenRouter response. It keeps one
 * example of every shape the mapping cares about: a paid reasoning model, an
 * account preset backed by Anthropic, a free model, a tool-less model, a
 * batch-only entry, an image-output model, an expired entry, and entries with
 * missing capacities or modalities.
 */
export const catalog: OpenRouterModel[] = [
  {
    id: 'vendor/reasoning',
    canonical_slug: 'vendor/reasoning-2026',
    name: 'Vendor Reasoning',
    context_length: 200_000,
    architecture: { input_modalities: ['text', 'image', 'video'], output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { context_length: 100_000, max_completion_tokens: 64_000 },
    supported_parameters: ['tools', 'max_tokens', 'max_completion_tokens', 'structured_outputs', 'reasoning'],
    endpoints: ['/api/v1/chat/completions'],
    reasoning: {
      mandatory: false,
      supported_efforts: ['max', 'high', 'low', 'none'],
    },
  },
  {
    id: '@preset/anthropic-work',
    canonical_slug: 'anthropic/claude-work-2026',
    name: 'Preset: Anthropic Work',
    context_length: 1_000_000,
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
    pricing: { prompt: '0.000003', completion: '0.000015' },
    top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
    supported_parameters: ['tools', 'max_tokens', 'reasoning'],
    endpoints: ['/api/v1/chat/completions'],
    reasoning: { mandatory: true, supported_efforts: ['high', 'low'] },
  },
  {
    id: 'vendor/free:free',
    canonical_slug: 'vendor/free-2026',
    name: 'Vendor Free',
    context_length: 262_144,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0', completion: '0' },
    top_provider: { context_length: 262_144, max_completion_tokens: 32_768 },
    supported_parameters: ['tools', 'max_tokens'],
    endpoints: ['/api/v1/chat/completions'],
  },
  {
    id: 'vendor/no-tools',
    name: 'Vendor Without Tools',
    context_length: 100_000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { max_completion_tokens: 8_192 },
    supported_parameters: ['temperature'],
    endpoints: ['/api/v1/chat/completions'],
  },
  {
    id: 'vendor/batch:batch',
    name: 'Vendor Batch',
    context_length: 100_000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { max_completion_tokens: 8_192 },
    supported_parameters: ['tools'],
    endpoints: [],
  },
  {
    id: 'vendor/image-output',
    name: 'Vendor Image Output',
    context_length: 100_000,
    architecture: { input_modalities: ['text'], output_modalities: ['image', 'text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { max_completion_tokens: 8_192 },
    supported_parameters: ['tools'],
    endpoints: ['/api/v1/chat/completions'],
  },
  {
    id: 'vendor/expired',
    name: 'Vendor Expired',
    context_length: 100_000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { max_completion_tokens: 8_192 },
    supported_parameters: ['tools'],
    endpoints: ['/api/v1/chat/completions'],
    expiration_date: '2020-01-01',
  },
  {
    id: 'vendor/no-capacities',
    name: 'Vendor Without Capacities',
    architecture: { modality: 'text+image->text' },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    supported_parameters: ['tools', 'max_tokens'],
    endpoints: ['/api/v1/chat/completions'],
    reasoning: { mandatory: false },
  },
]
