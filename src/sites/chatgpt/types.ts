/**
 * ChatGPT site adapter types.
 */

export interface ChatGPTSession {
  accessToken: string;
  accessTokenExpiry: number;
  cookies: string;
  userAgent: string;
  deviceId: string;
}

export interface ChatGPTResponse {
  text: string;
  conversationId: string;
  messageId: string;
  model: string;
}

export interface ChatGPTModel {
  slug: string;
  title: string;
  description: string;
  maxTokens: number;
  tags: string[];
}
