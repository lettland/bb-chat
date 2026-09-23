/**
 * Mounts timeline `Block`s as individual OpenTUI renderables and reconciles them
 * across refreshes. Conversation messages become cards whose assistant body is a
 * real `MarkdownRenderable` (tree-sitter-highlighted code fences); tool calls,
 * diffs, and system notes are compact styled-text rows.
 *
 * Reconciliation is keyed by `Block.id`: a block whose id and kind are unchanged
 * is updated in place (`apply`) — crucially, the assistant `MarkdownRenderable`
 * keeps its instance so its incremental parse state is reused instead of a full
 * re-parse on every `thread:changed` event. Only genuinely added/removed rows are
 * constructed/destroyed.
 */

import {
  BoxRenderable,
  bg,
  bold,
  fg,
  getTreeSitterClient,
  MarkdownRenderable,
  type Renderable,
  StyledText,
  type TextChunk,
  TextRenderable,
} from "@opentui/core";
import { changeGlyph, patchLineTone } from "../diff-render.ts";
import { sanitizeText } from "../sanitize.ts";
import { diffColor, glyph, palette, syntaxStyle, toneColor } from "../theme.ts";
import {
  affordanceLabel,
  type Block,
  changeKindLabel,
  type DiffBlock,
  type MessageBlock,
  type WorkBlock,
} from "../timeline-model.ts";
import { PREVIEW_CAP } from "../timeline-render.ts";

/** Runtime selection/expansion state applied to a block when it is mounted/updated. */
export interface BlockOpts {
  selected: boolean;
  expanded: boolean;
  /** Cap on output/patch lines shown when a row is expanded. */
  maxLines: number;
}

/** A mounted block: its root renderable plus an in-place updater keyed to its id. */
export interface MountedBlock {
  id: string;
  kind: Block["kind"];
  /** Distinguishes structurally different renderings of one kind (see `variantOf`). */
  variant: string;
  root: Renderable;
  apply(block: Block, opts: BlockOpts): void;
}

/**
 * A mounted block can only be updated in place when it was built the same way.
 * An assistant message renders as markdown or, when it holds an unsafe link, as
 * plain text — different renderables, so switching between them remounts.
 */
export function variantOf(block: Block): string {
  if (block.kind === "message" && block.role === "assistant") {
    return block.plain ? "assistant-plain" : "assistant-markdown";
  }
  return block.kind === "message" ? "user" : "";
}

type Renderer = ConstructorParameters<typeof BoxRenderable>[0];

/** One styled chunk carrying an explicit fg and optional full-cell bg. */
function chunk(text: string, fgColor: string, bgColor?: string): TextChunk {
  return fg(fgColor)(bgColor ? bg(bgColor)(text) : text);
}

/**
 * Join per-line chunks into a StyledText. Each line ends with "\n"; the final one
 * is trimmed so a row doesn't render a trailing blank line.
 */
function styled(lines: TextChunk[]): StyledText {
  const last = lines[lines.length - 1];
  if (!last) return new StyledText([fg(toneColor("meta"))(" ")]);
  last.text = last.text.replace(/\n$/, "");
  return new StyledText(lines);
}

// ── message ────────────────────────────────────────────────────────────────

/** The card's role label (the card's left border is the gutter, so no glyph here). */
function textOrSpace(text: string): string {
  return text.length > 0 ? text : " ";
}

function roleHeader(role: "user" | "assistant"): string {
  return role === "assistant" ? "assistant" : "you";
}

function mountMessage(renderer: Renderer, block: MessageBlock): MountedBlock {
  const isAssistant = block.role === "assistant";
  const p = palette();
  const card = new BoxRenderable(renderer, {
    id: block.id,
    flexDirection: "column",
    border: ["left"],
    borderColor: isAssistant ? p.border.assistant : p.border.user,
    paddingLeft: 1,
    // A gap opens each new exchange and separates a reply from its prompt.
    marginTop: block.newExchange || isAssistant ? 1 : 0,
    backgroundColor: isAssistant ? p.surface.assistantCard : p.surface.userCard,
  });
  card.add(
    new TextRenderable(renderer, {
      content: new StyledText([
        bold(fg(toneColor(isAssistant ? "assistant" : "user"))(roleHeader(block.role))),
      ]),
    }),
  );

  if (isAssistant && block.plain) {
    // Shown verbatim (nothing clickable) because it links to a blocked scheme.
    card.add(
      new TextRenderable(renderer, {
        content: "shown as plain text: contains a link with a blocked scheme",
        fg: toneColor("attention"),
      }),
    );
    const body = new TextRenderable(renderer, {
      content: textOrSpace(block.text),
      fg: toneColor("assistant"),
    });
    card.add(body);
    return {
      id: block.id,
      kind: "message",
      variant: variantOf(block),
      root: card,
      apply(next) {
        body.content = textOrSpace((next as MessageBlock).text);
      },
    };
  }

  if (isAssistant) {
    const md = new MarkdownRenderable(renderer, {
      content: block.text.length > 0 ? block.text : " ",
      syntaxStyle: syntaxStyle(),
      treeSitterClient: getTreeSitterClient(),
      streaming: block.streaming,
    });
    card.add(md);
    return {
      id: block.id,
      kind: "message",
      variant: variantOf(block),
      root: card,
      apply(next) {
        const b = next as MessageBlock;
        md.streaming = b.streaming;
        md.content = b.text.length > 0 ? b.text : " ";
      },
    };
  }

  const body = new TextRenderable(renderer, {
    content: block.text.length > 0 ? block.text : " ",
    fg: toneColor("user"),
  });
  card.add(body);
  return {
    id: block.id,
    kind: "message",
    variant: variantOf(block),
    root: card,
    apply(next) {
      const b = next as MessageBlock;
      body.content = b.text.length > 0 ? b.text : " ";
    },
  };
}

// ── work ───────────────────────────────────────────────────────────────────

function workChunks(block: WorkBlock, opts: BlockOpts): TextChunk[] {
  const sel = opts.selected ? palette().surface.selection : undefined;
  const cursor = opts.selected ? glyph.cursor : " ";
  const header = `${cursor} ${block.glyph} ${block.title}${affordanceLabel(
    block.expandable,
    opts.expanded,
    block.output.length,
  )}`;
  const lines: TextChunk[] = [chunk(`${header}\n`, toneColor(block.tone), sel)];

  const bodyTone = toneColor(block.errored ? "error" : "output");
  if (block.expandable && opts.expanded) {
    const shown = block.output.slice(0, opts.maxLines);
    for (const line of shown) lines.push(chunk(`      ${line}\n`, bodyTone, sel));
    if (block.output.length > shown.length) {
      lines.push(
        chunk(
          `      … +${block.output.length - shown.length} more lines\n`,
          toneColor("meta"),
          sel,
        ),
      );
    }
  } else if (block.output.length > 0) {
    const first = block.output.find((l) => l.trim().length > 0) ?? "";
    const preview = first.length > PREVIEW_CAP ? `${first.slice(0, PREVIEW_CAP - 1)}…` : first;
    if (preview.length > 0) lines.push(chunk(`      ${preview}\n`, bodyTone, sel));
  }
  return lines;
}

function mountWork(renderer: Renderer, block: WorkBlock, opts: BlockOpts): MountedBlock {
  const text = new TextRenderable(renderer, {
    id: block.id,
    content: styled(workChunks(block, opts)),
  });
  return {
    id: block.id,
    kind: "work",
    variant: variantOf(block),
    root: text,
    apply(next, o) {
      text.content = styled(workChunks(next as WorkBlock, o));
    },
  };
}

// ── diff ───────────────────────────────────────────────────────────────────

function diffChunks(block: DiffBlock, opts: BlockOpts): TextChunk[] {
  const sel = opts.selected ? palette().surface.selection : undefined;
  const cursor = opts.selected ? glyph.cursor : " ";
  // This row exists because a file changed, so never say "no changes": fall back
  // to the humanized change kind when there are no line stats.
  const hasStats = block.added > 0 || block.removed > 0;
  const stats = hasStats ? `+${block.added} -${block.removed}` : changeKindLabel(block.changeKind);
  const rename = block.movePath ? ` → ${block.movePath}` : "";
  const patchLines = block.patch !== null ? block.patch.split("\n") : [];
  const affordance = affordanceLabel(block.expandable, opts.expanded, patchLines.length);
  const header = `${cursor} ${changeGlyph(block.changeKind ?? "")} ${block.path}${rename}  ${stats}${affordance}`;
  const lines: TextChunk[] = [chunk(`${header}\n`, diffColor("file"), sel)];

  if (block.expandable && opts.expanded) {
    const shown = patchLines.slice(0, opts.maxLines);
    for (const line of shown) lines.push(chunk(`  ${line}\n`, diffColor(patchLineTone(line)), sel));
    if (patchLines.length > shown.length) {
      lines.push(
        chunk(`  … +${patchLines.length - shown.length} more lines\n`, diffColor("meta"), sel),
      );
    }
  }
  return lines;
}

function mountDiff(renderer: Renderer, block: DiffBlock, opts: BlockOpts): MountedBlock {
  const text = new TextRenderable(renderer, {
    id: block.id,
    content: styled(diffChunks(block, opts)),
  });
  return {
    id: block.id,
    kind: "diff",
    variant: variantOf(block),
    root: text,
    apply(next, o) {
      text.content = styled(diffChunks(next as DiffBlock, o));
    },
  };
}

// ── system / error / empty ───────────────────────────────────────────────────

function mountLine(renderer: Renderer, block: Block, text: string, color: string): MountedBlock {
  // Sanitize on the FIRST paint too, not only in apply(): error blocks are built
  // ad hoc from untrusted SDK error messages, so a raw first frame would defeat
  // the sanitizer for one render.
  const node = new TextRenderable(renderer, {
    id: block.id,
    content: sanitizeText(text),
    fg: color,
  });
  return {
    id: block.id,
    kind: block.kind,
    variant: variantOf(block),
    root: node,
    apply(next) {
      if (next.kind === "system" || next.kind === "error") node.content = sanitizeText(next.text);
    },
  };
}

/** Build a renderable + updater for one block. */
export function mountBlock(renderer: Renderer, block: Block, opts: BlockOpts): MountedBlock {
  switch (block.kind) {
    case "message":
      return mountMessage(renderer, block);
    case "work":
      return mountWork(renderer, block, opts);
    case "diff":
      return mountDiff(renderer, block, opts);
    case "system":
      return mountLine(renderer, block, `  ${block.text}`, toneColor("system"));
    case "error":
      return mountLine(renderer, block, block.text, toneColor("error"));
    case "empty":
      return mountLine(renderer, block, "(no messages yet)", toneColor("meta"));
  }
}

/**
 * Reconcile the `container`'s children to match `blocks`, reusing existing mounted
 * renderables by id (updating them in place) and constructing/destroying only the
 * difference. Children are reordered to match `blocks` order. Returns the updated
 * id→MountedBlock map.
 */
export function reconcileBlocks(
  renderer: Renderer,
  container: BoxRenderable,
  previous: Map<string, MountedBlock>,
  blocks: readonly Block[],
  optsFor: (block: Block) => BlockOpts,
): Map<string, MountedBlock> {
  const next = new Map<string, MountedBlock>();
  const ordered: MountedBlock[] = [];

  for (const block of blocks) {
    const opts = optsFor(block);
    const existing = previous.get(block.id);
    if (existing && existing.kind === block.kind && existing.variant === variantOf(block)) {
      existing.apply(block, opts);
      next.set(block.id, existing);
      ordered.push(existing);
      previous.delete(block.id);
    } else {
      if (existing) {
        container.remove(existing.root);
        existing.root.destroy();
        previous.delete(block.id);
      }
      const mounted = mountBlock(renderer, block, opts);
      next.set(block.id, mounted);
      ordered.push(mounted);
    }
  }

  // Destroy anything left over (removed rows).
  for (const stale of previous.values()) {
    container.remove(stale.root);
    stale.root.destroy();
  }

  // Reattach only when the order actually changed — the common streaming refresh
  // appends at the tail and leaves existing rows in place, so skipping the
  // detach/reattach churn avoids relayout jank mid-stream. New mounts aren't in
  // the container yet, so any addition/removal/reorder makes the arrays differ.
  const current = container.getChildren();
  const orderUnchanged =
    current.length === ordered.length && ordered.every((m, i) => current[i] === m.root);
  if (!orderUnchanged) {
    for (const child of [...current]) container.remove(child);
    for (const mounted of ordered) container.add(mounted.root);
  }

  return next;
}
