// Every carrier the plugin knows. To add one, write a module like ups.js
// (id, name, keywords, formats, trackingUrl) and list it here. The order only
// breaks ties when two carriers claim the same number and nothing in the
// text tells them apart.
import dhl from './dhl.js';
import ups from './ups.js';
import usps from './usps.js';
import royalmail from './royalmail.js';
import postnl from './postnl.js';
import amazon from './amazon.js';
import fedex from './fedex.js';
import dpd from './dpd.js';
import hermes from './hermes.js';
import gls from './gls.js';
import post from './post.js';

export const CARRIERS = [dhl, ups, usps, royalmail, postnl, amazon, fedex, dpd, hermes, gls, post];

const byId = new Map(CARRIERS.map((c) => [c.id, c]));

export function carrierById(id) {
  return byId.get(id) ?? null;
}

/** The carrier a free-text name (e.g. schema.org `provider.name`) refers to. */
export function carrierByName(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  return CARRIERS.find((c) => c.id !== 'post' && c.keywords.test(name)) ?? null;
}
