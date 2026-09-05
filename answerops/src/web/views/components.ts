import { html, raw, type Raw } from "../html.js";
export function section(
  title: string,
  body: Raw,
  options: {
    id?: string;
    count?: string;
    countId?: string;
    note?: string | Raw;
  } = {},
): Raw {
  return html`<section class="section" ${options.id ? raw(`data-testid="${options.id}"`) : ""} > <header class="section-head"> <h2>${title}</h2> ${
    options.count != null
      ? html`<span class="count" ${options.countId ? raw(`data-testid="${options.countId}"`) : ""} >${options.count}</span >`
      : null
  } </header> ${
    options.note ? html`<p class="section-note">${options.note}</p>` : null
  }${body} </section>`;
}
export function table(headers: string[], rows: Raw[]): Raw {
  return html`<div class="table-wrap"> <table> <thead> <tr> ${headers.map((label) => html`<th scope="col">${label}</th>`)} </tr> </thead> <tbody> ${rows} </tbody> </table> </div>`;
}
export function empty(message: string, id?: string): Raw {
  return html`<div class="empty" ${id ? raw(`data-testid="${id}"`) : ""}> ${message} </div>`;
}
export function panel(title: string, body: Raw, id?: string): Raw {
  return html`<div class="panel" ${id ? raw(`data-testid="${id}"`) : ""}> <h3>${title}</h3> ${body} </div>`;
}
export function properties(rows: Array<[string, unknown]>): Raw {
  return html`<dl class="kv"> ${rows.map(
    ([label, value]) =>
      html`<dt>${label}</dt> <dd>${value == null ? "—" : String(value)}</dd>`,
  )} </dl>`;
}
