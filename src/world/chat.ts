import { at } from "./rngService";

let chatCounter = 0;

export type ChatMessage = {
  id: string;
  sender: string;
  timestamp: number;
  channel: "market" | "diplomacy" | "military" | "general";
  content: string;
  metadata?: Record<string, string>;
};

export type ChatState = {
  messages: ChatMessage[];
};

export function buildInitialChatState(): ChatState {
  return { messages: [] };
}

export function addChatMessage(
  chatState: ChatState,
  sender: string,
  channel: ChatMessage["channel"],
  content: string,
  seed: string,
  currentMonth: number,
): ChatMessage {
  chatCounter += 1;
  const message: ChatMessage = {
    id: `msg-${at(seed, `chat:${channel}:${sender}`, currentMonth)}-${chatCounter}`,
    sender,
    timestamp: currentMonth,
    channel,
    content,
  };
  chatState.messages.push(message);
  return message;
}

export function broadcastMessage(
  chatState: ChatState,
  sender: string,
  channel: ChatMessage["channel"],
  content: string,
  seed: string,
  currentMonth: number,
): void {
  addChatMessage(chatState, sender, channel, content, seed, currentMonth);
}
