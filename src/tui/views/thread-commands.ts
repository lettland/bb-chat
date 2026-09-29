import type { BBSdk } from "../../bb/sdk.ts";
import { sendText } from "../../bb/threads.ts";
import type { ViewHost } from "../navigator.ts";
import { REASONING_LEVELS } from "../spawn-wizard.ts";
import { DiffView } from "./diff-view.ts";
import { InteractionsView } from "./interactions-view.ts";
import { MessageView } from "./message-view.ts";
import { QueueView } from "./queue-view.ts";
import { TerminalsView } from "./terminals-view.ts";

/** Composer inputs intercepted as commands; everything else (incl. "/paths") sends. */
export const THREAD_COMMANDS = new Set([
  "exit",
  "quit",
  "q",
  "back",
  "diff",
  "terminals",
  "term",
  "interactions",
  "requests",
  "queued",
  "help",
  "actions",
  "stop",
  "retry",
  "compact",
  "clear",
  "cancel-plan",
  "clear-goal",
  "refresh",
  "model",
  "reasoning",
  "queue",
  "steer",
]);

/** Commands that take no argument, so a stray word is a usage error. */
const NO_ARG = ["stop", "retry", "compact", "clear", "cancel-plan", "clear-goal", "refresh"];

/** What a slash command needs from the thread view it runs in. */
interface ThreadCommandContext {
  host: ViewHost;
  sdk: BBSdk;
  threadId: string;
  /** Fallback for an unrecognized command: the view shows its help legend. */
  onUnknown: () => void;
}

/**
 * Run one slash command against the thread view. Returns the status-bar message
 * to show, or null when there is nothing to report; throws on bad usage.
 */
export async function runThreadCommand(
  ctx: ThreadCommandContext,
  name: string,
  args: string,
): Promise<string | null> {
  if (args && NO_ARG.includes(name)) throw new Error(`usage: /${name}`);
  switch (name) {
    case "exit":
    case "quit":
    case "q":
      ctx.host.exit();
      return "";
    case "back":
      void ctx.host.navigator.pop();
      return "";
    case "refresh":
      // A manual escape hatch for stale state the realtime stream can't cover —
      // e.g. a turn that finished while the socket was down. No fetch here:
      // `submit` already refetches after any action that returns a status.
      return "refreshed";
    case "diff":
      void ctx.host.navigator.push(new DiffView(ctx.sdk, ctx.threadId));
      return "";
    case "terminals":
    case "term":
      void ctx.host.navigator.push(new TerminalsView(ctx.sdk, ctx.threadId));
      return "";
    case "interactions":
    case "requests":
      void ctx.host.navigator.push(new InteractionsView(ctx.sdk, ctx.threadId));
      return "";
    case "queued":
      void ctx.host.navigator.push(new QueueView(ctx.sdk, ctx.threadId));
      return "";
    case "actions":
      void ctx.host.navigator.push(
        new MessageView("thread actions", [
          "/requests: pending approvals, questions and forms",
          "/queued: inspect, edit and dispatch queued messages",
          "/stop · /retry · /compact · /clear · /cancel-plan · /clear-goal",
          "/model <id> · /reasoning <level>",
          "/queue <text> · /steer <text>",
        ]),
      );
      return "";
    case "stop":
      await ctx.sdk.threads.stop({ threadId: ctx.threadId });
      return "stop requested";
    case "retry":
      await ctx.sdk.threads.retry({ threadId: ctx.threadId });
      return "retry requested";
    case "compact":
      await ctx.sdk.threads.compact({ threadId: ctx.threadId });
      return "compaction requested";
    case "clear":
      await ctx.sdk.threads.clearContext({ threadId: ctx.threadId });
      return "context cleared";
    case "cancel-plan":
      await ctx.sdk.threads.cancelPlan({ threadId: ctx.threadId });
      return "plan cancelled";
    case "clear-goal":
      await ctx.sdk.threads.clearGoal({ threadId: ctx.threadId });
      return "goal cleared";
    case "model":
      if (!args) throw new Error("usage: /model <model id>");
      await ctx.sdk.threads.update({ threadId: ctx.threadId, model: args });
      return `model set to ${args}`;
    case "reasoning":
      if (!REASONING_LEVELS.some((level) => level === args))
        throw new Error("usage: /reasoning <level>");
      await ctx.sdk.threads.update({
        threadId: ctx.threadId,
        reasoningLevel: args as (typeof REASONING_LEVELS)[number],
      });
      return `reasoning set to ${args}`;
    case "queue":
    case "steer": {
      if (!args) throw new Error(`usage: /${name} <text>`);
      const mode = name === "queue" ? "queue-if-active" : "steer";
      const result = await sendText(ctx.sdk, ctx.threadId, args, mode);
      return result.delivery === "queued" ? "message queued" : "message sent";
    }
    default:
      ctx.onUnknown();
      return null;
  }
}
