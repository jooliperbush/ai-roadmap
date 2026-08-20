import { html, Raw } from '../html.js';
import { flash } from './layout.js';

export function loginView(error: string | null, demoHint: string | null): Raw {
  return html`
<div class="login-wrap">
  <div class="login-card">
    <div class="mark">◧</div>
    <h1>AnswerOps</h1>
    <p class="lede">Find the AI answers costing you trust or customers. Correct them. Prove the correction worked.</p>
    ${flash(error, 'error')}
    <form method="post" action="/login" class="stack">
      <div>
        <label for="email">Work email</label>
        <input id="email" name="email" type="email" autocomplete="username" required data-testid="email">
      </div>
      <div>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required data-testid="password">
      </div>
      <button class="primary" type="submit" data-testid="signin">Sign in</button>
    </form>
    ${demoHint ? html`<p class="hint" data-testid="demo-hint">${demoHint}</p>` : null}
  </div>
</div>`;
}
