/** The privacy policy and the terms. No landing.js here, so reading them is never counted as a landing view. */
import { breadcrumbLd, SITE_NAME } from '../../web/seo.js';
import { publicPage } from '../../web/views/layout.js';
import { privacyView, termsView } from '../../web/views/legal.js';

import type { Runtime } from '../context.js';

const PAGES = [
  {
    path: '/privacy',
    name: 'Privacy Policy',
    description:
      'What personal data Miscited collects when you request an audit or use the service, why, who else handles it, and how to ask for a copy or deletion.',
    view: privacyView,
  },
  {
    path: '/terms',
    name: 'Terms of Service',
    description:
      'The terms for using Miscited: what the service does, early access, why AI answers and our checks can be wrong, acceptable use, fees and liability.',
    view: termsView,
  },
];

export function legalRoutes(r: Runtime): void {
  for (const legal of PAGES)
    r.app.get(legal.path, async (_req, reply) =>
      reply.type('text/html; charset=utf-8').send(
        publicPage(
          {
            title: `${legal.name} · ${SITE_NAME}`,
            description: legal.description,
            path: legal.path,
            script: null,
            extra: [
              breadcrumbLd([
                { name: SITE_NAME, path: '/' },
                { name: legal.name, path: legal.path },
              ]),
            ],
          },
          legal.view(),
        ),
      ),
    );
}
