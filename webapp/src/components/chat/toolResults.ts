import { createContext } from "react";

// Loads a tool call's result by its call id, for conversations that leave results out
// (the Forge's): a call's result is only fetched when it's opened.
export const ToolResults = createContext<((callId: string) => Promise<string>) | null>(null);
