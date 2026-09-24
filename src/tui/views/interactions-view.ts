import { BoxRenderable, type KeyEvent, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import type { JsonValue } from "bb-app";
import type { BBSdk } from "../../bb/sdk.ts";
import { getTimelineRows, type Unsubscribe, watchThread } from "../../bb/threads.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import { sanitizeText } from "../sanitize.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";

type Interaction = Awaited<ReturnType<BBSdk["threads"]["interactions"]["list"]>>[number];
type ApprovalSubject = Extract<Interaction["payload"], { kind: "approval" }>["subject"];
type ApprovalEvidence = { text: string; reviewable: boolean };

function approvalEvidence(subject: ApprovalSubject, rows: readonly unknown[]): ApprovalEvidence {
  const workKind = subject.kind === "file_change" ? "file-change" : "tool";
  const matches: Record<string, unknown>[] = [];
  const visit = (row: unknown): void => {
    if (!row || typeof row !== "object") return;
    const record = row as Record<string, unknown>;
    if (record.kind === "work" && record.workKind === workKind && record.callId === subject.itemId)
      matches.push(record);
    if (record.kind === "turn" && Array.isArray(record.children))
      for (const child of record.children) visit(child);
  };
  for (const row of rows) visit(row);

  if (subject.kind === "tool_use") {
    const work = matches[0];
    if (
      !work ||
      typeof work.toolName !== "string" ||
      !work.toolArgs ||
      typeof work.toolArgs !== "object"
    )
      return {
        text: "Tool arguments unavailable. Approval disabled; deny or refresh.",
        reviewable: false,
      };
    return {
      text: `Tool: ${work.toolName}\nArguments:\n${JSON.stringify(work.toolArgs, null, 2)}`,
      reviewable: true,
    };
  }

  if (matches.length === 0)
    return {
      text: "File patch unavailable. Approval disabled; deny or refresh.",
      reviewable: false,
    };
  const changes = matches.map((work) => {
    const change = work.change;
    if (!change || typeof change !== "object") return null;
    const file = change as Record<string, unknown>;
    if (typeof file.path !== "string" || typeof file.diff !== "string" || !file.diff.trim())
      return null;
    const destination = typeof file.movePath === "string" ? ` → ${file.movePath}` : "";
    return `${file.kind ?? "change"}: ${file.path}${destination}\n${file.diff}`;
  });
  if (changes.some((change) => change === null))
    return {
      text: "A file patch is unavailable. Approval disabled; deny or refresh.",
      reviewable: false,
    };
  return { text: changes.join("\n\n"), reviewable: true };
}

function label(interaction: Interaction): string {
  const payload = interaction.payload;
  if (payload.kind === "approval") return `approval: ${payload.subject.kind}`;
  if (payload.kind === "user_question") return `question: ${payload.questions[0]?.prompt ?? ""}`;
  return `form: ${payload.title}`;
}

function detail(interaction: Interaction, evidence?: ApprovalEvidence): string {
  const payload = interaction.payload;
  if (payload.kind === "approval") {
    const subject = payload.subject;
    const body =
      subject.kind === "command"
        ? `${subject.command}${subject.cwd ? `\nIn: ${subject.cwd}` : ""}`
        : subject.kind === "plan"
          ? subject.plan
          : subject.kind === "tool_use"
            ? `${subject.presentation.title ?? subject.tool}\n${evidence?.text ?? "Loading tool arguments…"}`
            : subject.kind === "file_change"
              ? `${subject.writeScope ?? "file change"}\n${evidence?.text ?? "Loading file patch…"}`
              : `${subject.toolName ?? "permission"}\n${JSON.stringify(subject.permissions)}`;
    return `${subject.kind}${payload.reason ? `\nReason: ${payload.reason}` : ""}\n${body}`;
  }
  if (payload.kind === "user_question") {
    return payload.questions
      .map((question) => {
        const options = question.options
          ?.map((option) => `${option.value}: ${option.label}`)
          .join(" · ");
        return `${question.id}: ${question.prompt}${options ? `\n${options}` : ""}`;
      })
      .join("\n\n");
  }
  return `${payload.title}\n${JSON.stringify(payload.data, null, 2)}`;
}

/** Parse a short answer for one question, or a JSON answer map for several. */
export function parseInteractionAnswer(interaction: Interaction, raw: string): JsonValue {
  const payload = interaction.payload;
  if (payload.kind !== "user_question") return JSON.parse(raw);
  if (payload.questions.length !== 1) return { kind: "user_answer", answers: JSON.parse(raw) };
  const question = payload.questions[0];
  if (!question) throw new Error("question is missing");
  if (raw.trimStart().startsWith("{")) return { kind: "user_answer", answers: JSON.parse(raw) };
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = new Set(question.options?.map((option) => option.value) ?? []);
  if (values.length > 0 && values.every((value) => allowed.has(value))) {
    if (!question.multiSelect && values.length > 1) throw new Error("choose one option");
    return { kind: "user_answer", answers: { [question.id]: { selected: values } } };
  }
  if (question.allowFreeText && raw.trim()) {
    return {
      kind: "user_answer",
      answers: { [question.id]: { selected: [], freeText: raw.trim() } },
    };
  }
  throw new Error("enter an option value shown above");
}

/** Pending BB approvals, questions and plugin forms for one thread. */
export class InteractionsView implements View {
  readonly title = "interactions";
  private host!: ViewHost;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private details: TextRenderable | null = null;
  private detailPane: ScrollBoxRenderable | null = null;
  private answer: TextRenderable | null = null;
  private rows: Interaction[] = [];
  private evidence = new Map<string, ApprovalEvidence>();
  private selected = 0;
  private input = new InputBuffer();
  private answering = false;
  private busy = false;
  private generation = 0;
  private refreshSeq = 0;
  private unsub: Unsubscribe | null = null;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    this.generation++;
    this.rows = [];
    this.evidence.clear();
    this.selected = 0;
    const screen = new Screen(host.renderer, {
      title: "pending interactions",
      hints:
        "↑/↓ select · pgup/pgdn details · a allow · s session · d deny · enter answer · esc back",
    });
    const panel = new ListPanel(host.renderer, { height: 7, flexGrow: 0 });
    const details = new TextRenderable(host.renderer, { content: "" });
    const detailPane = new ScrollBoxRenderable(host.renderer, { flexGrow: 1 });
    detailPane.add(details);
    const answer = new TextRenderable(host.renderer, { content: "", visible: false });
    screen.content.add(panel.root);
    screen.content.add(new BoxRenderable(host.renderer, { height: 1 }));
    screen.content.add(detailPane);
    screen.content.add(answer);
    this.screen = screen;
    this.panel = panel;
    this.details = details;
    this.detailPane = detailPane;
    this.answer = answer;
    host.renderer.root.add(screen.outer);
    await this.refresh();
    this.unsub = watchThread(this.sdk, this.threadId, () => void this.refresh());
  }

  unmount(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.screen) {
      this.host.renderer.root.remove(this.screen.outer);
      this.screen.outer.destroy();
    }
    this.screen = null;
    this.panel = null;
    this.details = null;
    this.detailPane = null;
    this.answer = null;
    this.generation++;
  }

  onKey(key: KeyEvent): void {
    if (key.name === "escape") {
      if (this.answering) {
        this.answering = false;
        this.input.clear();
        this.render();
      } else void this.host.navigator.pop();
      return;
    }
    if (this.busy) return;
    if (key.name === "pageup") {
      this.detailPane?.scrollBy(-1, "viewport");
      return;
    }
    if (key.name === "pagedown") {
      this.detailPane?.scrollBy(1, "viewport");
      return;
    }
    if (this.answering) {
      const action = this.input.handle(key);
      if (action.type === "submit") void this.submitAnswer(action.value);
      else if (action.type === "update") this.render();
      return;
    }
    if (key.name === "up" || key.name === "k") this.move(-1);
    else if (key.name === "down" || key.name === "j") this.move(1);
    else if (key.name === "r") void this.refresh();
    else if (key.name === "a") void this.resolveApproval("allow_once");
    else if (key.name === "s") void this.resolveApproval("allow_for_session");
    else if (key.name === "d") void this.resolveApproval("deny");
    else if (key.name === "return" || key.name === "enter") {
      if (this.current()?.payload.kind !== "approval") {
        this.answering = true;
        this.render();
      }
    }
  }

  private current(): Interaction | undefined {
    return this.rows[this.selected];
  }

  private move(delta: number): void {
    this.selected = this.panel?.select(this.selected + delta) ?? 0;
    this.render();
  }

  private async refresh(): Promise<void> {
    const generation = this.generation;
    const refreshSeq = ++this.refreshSeq;
    try {
      const rows = await this.sdk.threads.interactions.list({ threadId: this.threadId });
      if (generation !== this.generation || refreshSeq !== this.refreshSeq || !this.panel) return;
      const pending = rows.filter((row) => row.status === "pending");
      const needsEvidence = pending.filter(
        (row) =>
          row.payload.kind === "approval" &&
          (row.payload.subject.kind === "file_change" || row.payload.subject.kind === "tool_use"),
      );
      let timeline: unknown[] = [];
      if (needsEvidence.length > 0) {
        try {
          timeline = await getTimelineRows(this.sdk, this.threadId);
        } catch {
          // Keep the requests visible for denial; missing evidence blocks approval.
        }
      }
      if (generation !== this.generation || refreshSeq !== this.refreshSeq || !this.panel) return;
      this.evidence = new Map(
        needsEvidence.map((row) => {
          if (row.payload.kind !== "approval") throw new Error("expected approval");
          return [row.id, approvalEvidence(row.payload.subject, timeline)];
        }),
      );
      this.rows = pending;
      this.selected = this.panel.setItems(
        this.rows.map(label),
        "no pending interactions",
        this.selected,
      );
      this.render();
    } catch (error) {
      if (generation === this.generation && refreshSeq === this.refreshSeq)
        this.panel?.showMessage(`error loading interactions: ${errorText(error)}`, "error");
    }
  }

  private render(): void {
    const row = this.current();
    if (this.details)
      this.details.content = row ? sanitizeText(detail(row, this.evidence.get(row.id))) : "";
    this.detailPane?.scrollTo(0);
    if (this.answer) {
      this.answer.visible = this.answering;
      this.answer.content = this.answering ? sanitizeText(`❯ ${this.input.value}`) : "";
    }
    this.screen?.setContext([`${this.rows.length} pending`]);
    if (this.answering)
      this.screen?.setHints(
        "enter submit · esc cancel · one question: option value or text · many questions/form: JSON",
      );
  }

  private async resolveApproval(
    decision: "allow_once" | "allow_for_session" | "deny",
  ): Promise<void> {
    const row = this.current();
    if (row?.payload.kind !== "approval") return;
    if (
      decision !== "deny" &&
      (row.payload.subject.kind === "file_change" || row.payload.subject.kind === "tool_use") &&
      !this.evidence.get(row.id)?.reviewable
    ) {
      this.screen?.setStatus("Approval disabled: change or tool arguments unavailable", "error");
      return;
    }
    if (!row.payload.availableDecisions.includes(decision)) {
      this.screen?.setStatus(`${decision} is unavailable for this request`, "error");
      return;
    }
    const subject = row.payload.subject;
    const grantedPermissions =
      subject.kind === "permission_grant"
        ? subject.permissions
        : "sessionGrant" in subject
          ? subject.sessionGrant
          : null;
    this.busy = true;
    try {
      await this.sdk.threads.interactions.resolve({
        threadId: this.threadId,
        interactionId: row.id,
        resolution: decision === "deny" ? { decision } : { decision, grantedPermissions },
      });
      await this.refresh();
    } catch (error) {
      this.screen?.setStatus(`resolution failed: ${errorText(error)}`, "error");
    } finally {
      this.busy = false;
    }
  }

  private async submitAnswer(raw: string): Promise<void> {
    const row = this.current();
    if (!row || !raw.trim()) return;
    this.busy = true;
    try {
      const answer = parseInteractionAnswer(row, raw);
      if (row.origin?.kind === "plugin") {
        await this.sdk.threads.interactions.respond({
          threadId: this.threadId,
          interactionId: row.id,
          value: answer,
        });
      } else if (row.payload.kind === "user_question") {
        await this.sdk.threads.interactions.resolve({
          threadId: this.threadId,
          interactionId: row.id,
          resolution: answer as Extract<
            Parameters<BBSdk["threads"]["interactions"]["resolve"]>[0]["resolution"],
            { kind: "user_answer" }
          >,
        });
      } else {
        await this.sdk.threads.interactions.resolve({
          threadId: this.threadId,
          interactionId: row.id,
          resolution: { kind: "request_answer", value: answer },
        });
      }
      this.input.clear();
      this.answering = false;
      await this.refresh();
    } catch (error) {
      this.screen?.setStatus(`answer failed: ${errorText(error)}`, "error");
    } finally {
      this.busy = false;
    }
  }
}
