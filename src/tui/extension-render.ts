/**
 * Renders BB plugins and skills into rows for the extension views.
 * Structural/defensive (D2).
 */

export interface PluginRow {
  id: string;
  name: string;
  enabled: boolean;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
}

function str(rec: Record<string, unknown>, key: string): string {
  const value = rec[key];
  return typeof value === "string" ? value : "";
}

/** Extract plugin rows from a `plugins.list` response. */
export function toPluginRows(response: unknown): PluginRow[] {
  if (!response || typeof response !== "object") return [];
  const plugins = (response as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) return [];
  const rows: PluginRow[] = [];
  for (const plugin of plugins) {
    if (!plugin || typeof plugin !== "object") continue;
    const rec = plugin as Record<string, unknown>;
    const id = str(rec, "id");
    if (!id) continue;
    rows.push({ id, name: str(rec, "name") || id, enabled: rec.enabled === true });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** Extract skill rows from a `skills.list` response. */
export function toSkillRows(response: unknown): SkillRow[] {
  if (!response || typeof response !== "object") return [];
  const skills = (response as { skills?: unknown }).skills;
  if (!Array.isArray(skills)) return [];
  const rows: SkillRow[] = [];
  for (const skill of skills) {
    if (!skill || typeof skill !== "object") continue;
    const rec = skill as Record<string, unknown>;
    const id = str(rec, "id") || str(rec, "skillId") || str(rec, "name");
    if (!id) continue;
    rows.push({ id, name: str(rec, "name") || id, description: str(rec, "description") });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** One-line display for a plugin row. */
export function formatPluginRow(row: PluginRow): string {
  return `${row.enabled ? "●" : "○"} ${row.name}`;
}

/** One-line display for a skill row. */
export function formatSkillRow(row: SkillRow): string {
  return row.description ? `${row.name} — ${row.description}` : row.name;
}
