// ai-types.ts — Pioneer custom types for Vercel AI SDK 6
//
// UIMessage<METADATA, DATA_PARTS, TOOLS>
//   METADATA = never (we don't use message metadata)
//   DATA_PARTS = PioneerDataParts (buttons + session)
//   TOOLS = never (we don't need tool type inference on frontend)
//
// Data parts convention:
//   - In code: key is without "data-" prefix (e.g., 'pioneer-buttons')
//   - In stream protocol: automatically prefixed as 'data-pioneer-buttons'
//   - In message.parts[]: type is 'data-pioneer-buttons'

import { UIMessage } from 'ai';

// === BUTTON CONFIG (same interface as button-detector.ts) ===
export interface ButtonConfig {
  id: string;
  label: string;
  type: 'option' | 'action';
  style: 'primary' | 'secondary' | 'ghost';
  chatMessage?: string;
  action?: string;
  params?: Record<string, unknown>;
}

// === ACTION CONTEXT (DB IDs for action-handler) ===
export interface ActionContext {
  sessionId?: string;
  planId?: string;
  postId?: string;
  imageUrls?: string[];
}

// === CUSTOM DATA PARTS for AI SDK 6 ===
// Keys here map to stream types:
//   'pioneer-buttons' → streamed as 'data-pioneer-buttons'
//   'pioneer-session' → streamed as 'data-pioneer-session' (transient)

export type PioneerDataParts = {
  'pioneer-buttons': {
    buttons: ButtonConfig[];
    actionContext?: ActionContext;
  };
  'pioneer-session': {
    sessionId: string;
  };
};

// === PIONEER UI MESSAGE TYPE ===
// Used by useChat<PioneerUIMessage> and createUIMessageStream<PioneerUIMessage>
export type PioneerUIMessage = UIMessage<
  never,            // METADATA — we don't use message metadata
  PioneerDataParts  // DATA_PARTS — buttons + session
>;
