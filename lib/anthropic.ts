// lib/anthropic.ts — Shared Anthropic client + model constant
//
// Single source of truth for:
// - Anthropic client instance (reused across all files)
// - Model version (change in ONE place)

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-sonnet-4-5-20250929';

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}
