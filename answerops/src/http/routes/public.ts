import { FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { postBySlug, postsNewestFirst } from '../../content/posts.js';
import { jsonParse, id as newId, nowIso, verifyPassword } from '../../db/index.js';
import * as repo from '../../db/repo/index.js';
import { liveProviderCount } from '../../providers/registry.js';
import { createAuditReport, getAuditReportByToken, runAudit, startMonitoring } from '../../services/audit.js';
import { buildDashboard } from '../../services/dashboard.js';
import { countLaunchEvent, LAUNCH_EVENTS, trafficSource } from '../../services/traffic.js';
import {
  blogPostingLd,
  breadcrumbLd,
  faqLd,
  faviconSvg,
  organizationLd,
  renderLlmsTxt,
  renderRobots,
  renderSitemap,
  SITE_NAME,
  sitemapEntries,
  softwareLd,
} from '../../web/seo.js';
import { blogIndexView, postView } from '../../web/views/blog.js';
import { dashboardView } from '../../web/views/dashboard.js';
import { landingView } from '../../web/views/landing.js';
import { flash, marketingPage, page, publicPage, reportPage } from '../../web/views/layout.js';
import { loginView } from '../../web/views/login.js';
import { auditReportView } from '../../web/views/ops.js';

import { html, type Raw } from '../../web/html.js';
import type { Runtime } from '../context.js';
import { forbidden, redirectWith } from '../context.js';
import { HOME_FAQ, PUBLIC_DESCRIPTION } from '../public-copy.js';
export function publicRoutes(r: Runtime): void {
  const { db, app, clock } = r;
  const credentials = (reply: FastifyReply, tenantId: string, userId: string) => {
    const sid = randomBytes(32).toString('hex');
    repo.createSession(db, tenantId, userId, sid, 24, randomBytes(24).toString('hex'));
    reply.setCookie('aops', sid, { path: '/', httpOnly: true, sameSite: 'lax' });
  };
  app.get('/login', async (req, reply) => {
    if (r.auth(req)) return reply.redirect('/');
    return reply.type('text/html; charset=utf-8').send(
      page(
        'Sign in',
        {
          email: null,
          tenantName: null,
          brandName: null,
          active: 'login',
          csrf: '',
          brands: [],
          brandId: null,
          role: null,
        },
        loginView((req.query as Record<string, string>).msg ?? null, r.options.demoHint ?? null),
      ),
    );
  });
  app.post('/login', async (req, reply) => {
    const blocked = r.limiter.peek('POST /login', req.ip ?? 'unknown');
    if (!blocked.ok)
      return reply
        .code(429)
        .header('retry-after', String(blocked.retryAfterSec))
        .type('text/html')
        .send(
          forbidden(
            `Too many failed sign-in attempts. Try again in ${Math.ceil(blocked.retryAfterSec / 60)} minutes.`,
          ),
        );
    const body = (req.body ?? {}) as Record<string, string>,
      user = repo.findUserByEmail(db, body.email ?? '');
    if (!user || !verifyPassword(body.password ?? '', user.password_hash, user.password_salt)) {
      const limit = r.limiter.check('POST /login', req.ip ?? 'unknown');
      if (!limit.ok)
        return reply
          .code(429)
          .header('retry-after', String(limit.retryAfterSec))
          .type('text/html')
          .send(
            forbidden(
              `Too many failed sign-in attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minutes.`,
            ),
          );
      return redirectWith(reply, '/login', 'Those credentials do not match an account.', 'error');
    }
    credentials(reply, user.tenant_id, user.id);
    repo.audit(db, user.tenant_id, user.email, 'login', 'user', user.id, '');
    return reply.redirect('/');
  });
  app.post('/logout', async (req, reply) => {
    if (req.cookies?.aops) repo.deleteSession(db, req.cookies.aops);
    reply.clearCookie('aops', { path: '/' });
    reply.clearCookie('brand', { path: '/' });
    return reply.redirect('/login');
  });
  app.get('/', async (req, reply) => {
    const a = r.auth(req);
    if (!a)
      return reply
        .type('text/html; charset=utf-8')
        .send(
          marketingPage(
            'Miscited · quality control for what AI says about your company',
            PUBLIC_DESCRIPTION,
            landingView({ liveProviders: liveProviderCount() }),
            [organizationLd(), softwareLd(), faqLd(HOME_FAQ)],
          ),
        );
    const c = r.context(req, reply, a);
    return c.show(
      'Answer desk',
      'dashboard',
      dashboardView(buildDashboard(db, a.tenantId, c.brand.id, c.query.window ?? null)),
    );
  });
  app.post('/launch-event', { bodyLimit: 512 }, async (req, reply) => {
    const parsed = z.object({ source: z.string().max(30), event: z.enum(LAUNCH_EVENTS) }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid launch event' });
    countLaunchEvent(db, parsed.data.source, parsed.data.event, clock.now());
    return reply.code(202).send({ ok: true });
  });
  const auditRequest = z.object({
    source: z.unknown().optional(),
    email: z.string().trim().email('Enter a work email we can send the audit to.'),
    domain: z
      .string()
      .trim()
      .min(4, 'Enter the domain to audit.')
      .regex(/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i, 'That does not look like a domain.'),
  });
  app.post('/audit-request', async (req, reply) => {
    const parsed = auditRequest.safeParse(req.body ?? {});
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid request' });
    const domain = parsed.data.domain
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, ''),
      requestId = newId('req');
    const report = db.transaction(() => {
      db.prepare(
        'INSERT INTO audit_requests (id, email, domain, source, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(requestId, parsed.data.email.toLowerCase(), domain, trafficSource(parsed.data.source), nowIso());
      return createAuditReport(db, requestId, domain);
    })();
    if (r.fetcher)
      void r.tasks
        .track(
          runAudit(db, report.id, {
            fetcher: r.fetcher,
            clock,
            beliefs: r.options.beliefsFor?.('audit') ?? null,
            budgetRuns: Number(process.env.MISCITED_AUDIT_RUNS ?? 40),
          }),
        )
        .catch((error) => app.log.error({ err: error, reportId: report.id }, 'audit failed'));
    return reply.code(201).send({ ok: true, domain, reportUrl: `/audit/${report.token}` });
  });
  app.get('/audit/:token', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const renderReport = (title: string, description: string, body: Raw) =>
      reportPage(
        title,
        description,
        html`${flash(query.msg ?? null, query.kind === 'error' ? 'error' : 'ok')}${body}`,
      );
    const report = getAuditReportByToken(db, (req.params as Record<string, string>).token);
    if (!report)
      return reply
        .code(404)
        .type('text/html')
        .send(
          renderReport(
            'Not found',
            'No such audit.',
            html`<h1>Not found</h1>
              <p class="lede">No audit exists at this address.</p>`,
          ),
        );
    if (report.status !== 'complete')
      return reply.type('text/html; charset=utf-8').send(
        renderReport(
          `Audit of ${report.domain}`,
          'Your answer risk audit is running.',
          html`<h1>Auditing ${report.domain}</h1>
            <p class="lede" data-testid="audit-status">
              Status:
              ${report.status}.${
                report.error
                  ? ` ${report.error}`
                  : ' Reload in a minute; this page fills in when the sample completes.'
              }
            </p>`,
        ),
      );
    return reply.type('text/html; charset=utf-8').send(
      renderReport(
        `Answer risk audit: ${report.brand_name || report.domain}`,
        `A dated, evidence-linked audit of what AI answers say about ${report.domain}.`,
        auditReportView({
          report,
          findings: jsonParse<any>(report.findings, {}),
          candidates: jsonParse<any[]>(report.candidates, []),
          surfaces: jsonParse<string[]>(report.surfaces, []),
          notTested: jsonParse<string[]>(report.not_tested, []),
        }),
      ),
    );
  });
  app.post('/audit/:token/start', async (req, reply) => {
    const token = (req.params as Record<string, string>).token,
      body = (req.body ?? {}) as Record<string, string>;
    try {
      const parsed = z
        .object({
          email: z.string().trim().email('Enter a valid email address.'),
          password: z
            .string()
            .min(8, 'Choose a password with at least 8 characters.')
            .max(1024, 'Password is too long.'),
        })
        .safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid credentials');
      const result = startMonitoring(db, {
        token,
        email: parsed.data.email.toLowerCase(),
        weeklyEmail: body.weekly_email === 'yes',
        password: parsed.data.password,
        clock,
      });
      credentials(reply, result.tenantId, result.userId);
      return reply.redirect(
        '/weekly?msg=' + encodeURIComponent('Monitoring started. Review your weekly questions and Monday schedule below.'),
      );
    } catch (error) {
      return reply.redirect(
        `/audit/${token}?msg=${encodeURIComponent(error instanceof Error ? error.message : 'could not start monitoring')}&kind=error`,
      );
    }
  });
  app.get('/healthz', async () => ({ ok: true }));
  const cached = (url: string, type: string, render: () => string, seconds = 3600) =>
    app.get(url, async (_req, reply) =>
      reply.type(type).header('cache-control', `public, max-age=${seconds}`).send(render()),
    );
  cached('/robots.txt', 'text/plain; charset=utf-8', renderRobots);
  cached('/sitemap.xml', 'application/xml; charset=utf-8', () =>
    renderSitemap(sitemapEntries(postsNewestFirst().map((p) => ({ slug: p.slug, updated: p.updated })))),
  );
  cached('/llms.txt', 'text/plain; charset=utf-8', () =>
    renderLlmsTxt(postsNewestFirst().map((p) => ({ slug: p.slug, title: p.title, summary: p.summary }))),
  );
  cached('/favicon.svg', 'image/svg+xml', faviconSvg, 86400);
  app.get('/blog', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(
      publicPage(
        {
          title: `Writing · ${SITE_NAME}`,
          description:
            'How to measure what AI assistants say about a company without fooling yourself: sample sizes, intervals, and what separates a wrong answer from a missing one.',
          path: '/blog',
          stylesheet: '/static/blog.css',
          script: null,
          extra: [
            breadcrumbLd([
              { name: 'Miscited', path: '/' },
              { name: 'Writing', path: '/blog' },
            ]),
          ],
        },
        blogIndexView(postsNewestFirst()),
      ),
    ),
  );
  app.get('/blog/:slug', async (req, reply) => {
    const post = postBySlug((req.params as Record<string, string>).slug);
    if (!post)
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send(
          publicPage(
            {
              title: `Not found · ${SITE_NAME}`,
              description: 'No such page.',
              path: '/blog',
              stylesheet: '/static/blog.css',
              script: null,
            },
            html`<article class="post">
              <h1>Not found</h1>
              <p class="lede">No post exists at this address.</p>
            </article>`,
          ),
        );
    return reply.type('text/html; charset=utf-8').send(
      publicPage(
        {
          title: `${post.metaTitle} · ${SITE_NAME}`,
          description: post.metaDescription,
          path: `/blog/${post.slug}`,
          stylesheet: '/static/blog.css',
          script: null,
          extra: [
            blogPostingLd(post),
            faqLd(post.faq),
            breadcrumbLd([
              { name: 'Miscited', path: '/' },
              { name: 'Writing', path: '/blog' },
              { name: post.metaTitle, path: `/blog/${post.slug}` },
            ]),
          ],
        },
        postView(
          post,
          postsNewestFirst().filter((p) => p.slug !== post.slug),
        ),
      ),
    );
  });
}
