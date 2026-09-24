/**
 * Who runs Miscited.
 *
 * The privacy policy, the terms and the public contact lines all read from this one object. A
 * null field is a fact the owner has not declared yet: the pages leave that line out rather than
 * print a placeholder, and none of these values is to be filled in with a guess.
 */

export interface Operator {
  /** The name the site trades under. */
  name: string;
  /** The person or registered entity legally responsible for the service. */
  legalName: string | null;
  /** A postal address for legal notices and privacy requests. */
  address: string | null;
  /** Company registration number and register, if the operator is a company. */
  companyNumber: string | null;
  /** The mailbox for privacy requests, legal notices and general contact. */
  email: string;
  /** The law that governs the terms and the courts that hear disputes under them. */
  jurisdiction: string | null;
}

export const OPERATOR: Operator = {
  name: 'Miscited',
  // TODO(owner): the legal name of the person or company that operates Miscited.
  legalName: null,
  // TODO(owner): a postal address for legal notices and privacy requests.
  address: null,
  // TODO(owner): the company number and register, if a company operates Miscited.
  companyNumber: null,
  email: 'hello@miscited.com',
  // TODO(owner): the governing law and courts for the terms. The terms omit that section until this is set.
  jurisdiction: null,
};

/** Shown as "Last updated" on both legal pages and used as their sitemap lastmod. */
export const LEGAL_UPDATED = '2026-09-24';
