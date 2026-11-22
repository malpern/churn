/**
 * The prompt churn suggests pasting into ChatGPT or Claude to write a
 * person's interests. It asks for a closing "Topics:" line, which churn reads
 * to build the Learn page, and for nothing private.
 */
export const LEARNING_PROMPT = [
  "Based on what you know about me from our conversations, write a short description",
  "(150 to 250 words), in the first person, of what I'm interested in and what I'd like",
  "to learn more about. It's for an app that recommends documentaries.",
  "Leave out anything private, such as health details, money, or family.",
  'End with one line that starts with "Topics:" followed by 15 to 25 short,',
  'comma-separated topics of one to three words each, such as "space exploration" or "jazz".',
].join(" ");

export const CHATGPT_URL = `https://chatgpt.com/?q=${encodeURIComponent(LEARNING_PROMPT)}`;
export const CLAUDE_URL = `https://claude.ai/new?q=${encodeURIComponent(LEARNING_PROMPT)}`;
