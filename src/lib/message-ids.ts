import type { UIMessage } from "ai";
import { randomUUID } from "node:crypto";

/**
 * assistant-ui's runtime uses `message.id` as the key in its internal
 * message store (confirmed against @assistant-ui/react-ai-sdk's
 * convertMessage.ts, which does `id: message.id` when building its
 * ThreadMessage). If two messages in a hydrated array share an id —
 * observed here specifically as some AI SDK v7 assistant messages coming
 * back from `onEnd` with `id: ""` under certain multi-step tool-calling
 * turns — the store collapses them down to whichever one was processed
 * last, which is exactly the "only the latest message shows after reload"
 * symptom. This doesn't chase why the SDK occasionally hands back an empty
 * id; it just guarantees the invariant assistant-ui actually depends on
 * (every message has a stable, unique id) before anything is persisted or
 * rehydrated.
 */
export function ensureMessageIds<T extends UIMessage>(messages: T[]): T[] {
  const seen = new Set<string>();
  let changed = false;

  const fixed = messages.map((m) => {
    const needsNewId = !m.id || seen.has(m.id);
    if (!needsNewId) {
      seen.add(m.id);
      return m;
    }
    changed = true;
    const id = randomUUID();
    seen.add(id);
    return { ...m, id };
  });

  return changed ? fixed : messages;
}
