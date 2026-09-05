import { html, type Raw } from "../html.js";
import { flash } from "./layout.js";
export function loginView(error: string | null, demoHint: string | null): Raw {
  const fields = [
    {
      id: "email",
      label: "Work email",
      type: "email",
      autocomplete: "username",
    },
    {
      id: "password",
      label: "Password",
      type: "password",
      autocomplete: "current-password",
    },
  ];
  return html`<div class="login-wrap"> <section class="login-card" aria-labelledby="login-heading"> <span class="mark" aria-hidden="true">◧</span> <h1 id="login-heading">Miscited</h1> <p class="lede"> Find the AI answers costing you trust or customers. Correct them. Prove the correction worked. </p> ${flash(error, "error")} <form method="post" action="/login" class="stack"> ${fields.map(
    (field) =>
      html`<div> <label for="${field.id}">${field.label}</label ><input id="${field.id}" name="${field.id}" type="${field.type}" autocomplete="${field.autocomplete}" required data-testid="${field.id}"> </div>`,
  )}<button class="primary" type="submit" data-testid="signin"> Sign in </button> </form> ${
    demoHint
      ? html`<p class="hint" data-testid="demo-hint">${demoHint}</p>`
      : null
  } </section> </div>`;
}
