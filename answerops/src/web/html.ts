/** Trusted markup is explicit; every other template value is escaped recursively. */
export class Raw {
  constructor(public value: string) {}
}
export const raw = (value: string): Raw => new Raw(value);
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]!);
type Value = string | number | boolean | null | undefined | Raw | Value[];
function output(value: Value): string {
  if (value == null || value === false) return "";
  if (value instanceof Raw) return value.value;
  return Array.isArray(value)
    ? value.reduce<string>((text, item) => text + output(item), "")
    : escapeHtml(value);
}
export function html(parts: TemplateStringsArray, ...values: Value[]): Raw {
  return raw(
    parts.reduce(
      (text, part, index) =>
        text + part + (index < values.length ? output(values[index]) : ""),
      "",
    ),
  );
}
export function pct(value: number | null | undefined, digits = 0): string {
  return value == null || !Number.isFinite(value)
    ? "—"
    : `${(100 * value).toFixed(digits)}%`;
}
