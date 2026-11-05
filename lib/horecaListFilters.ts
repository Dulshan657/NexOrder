// The rules behind the customer list's brand and missing details filters (NX-0027).
//
// Pure: every function reads its arguments and returns a new value, so the list view can
// memoise on the customers and the tests can freeze their inputs.

import type { HoReCa } from '../types';

/**
 * What a customer's address holds when the customer was loaded without one: the column is
 * required, so the import writes this instead. It is not an address and must never be shown
 * as one.
 */
export const ADDRESS_PLACEHOLDER = 'Address needed';

const collapse = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** Lower case, trimmed, runs of spaces collapsed: how two spellings are compared. */
const compareKey = (value: string): string => collapse(value).toLowerCase();

/** The text trimmed, or '' when there is none or it is not text (a row read back from the database). */
export const cleanText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** True when the address is blank or is the placeholder, however it is typed. */
export const isAddressMissing = (address: unknown): boolean => {
  const text = cleanText(address);
  return text === '' || compareKey(text) === compareKey(ADDRESS_PLACEHOLDER);
};

/** The address to show or search: '' when it is blank or the placeholder. */
export const cleanAddress = (address: unknown): string => (isAddressMissing(address) ? '' : cleanText(address));

/** Each brand once by `compareKey`, in the order met, keeping the first spelling. */
const firstSeen = (brands: readonly string[]): Map<string, string> =>
  brands.reduce(
    (seen, brand) => (seen.has(compareKey(brand)) ? seen : seen.set(compareKey(brand), brand)),
    new Map<string, string>(),
  );

/** What the customer lists, as text: trimmed, spaces collapsed, blanks dropped. Repeats are kept. */
const listedBrands = (customer: Pick<HoReCa, 'buysBrands'>): string[] => {
  const raw: unknown[] = Array.isArray(customer.buysBrands) ? customer.buysBrands : [];
  return raw.map(cleanText).map(collapse).filter((brand) => brand !== '');
};

/** The brands a customer buys, each once. */
export const customerBrands = (customer: Pick<HoReCa, 'buysBrands'>): string[] => [
  ...firstSeen(listedBrands(customer)).values(),
];

/**
 * True when the office has something to chase: no phone, billing email or contact, or an
 * address that is blank or the placeholder. A missing ABN alone does not count, and nor do
 * missing brands.
 */
export const hasMissingDetails = (customer: HoReCa): boolean =>
  cleanText(customer.phone) === '' ||
  cleanText(customer.billingEmail) === '' ||
  cleanText(customer.contactName) === '' ||
  isAddressMissing(customer.address);

/**
 * Every brand the customers buy, once each and sorted, ignoring case and spacing. The
 * spelling shown is the first one seen.
 */
export const brandOptions = (customers: readonly HoReCa[]): string[] =>
  [...firstSeen(customers.flatMap(listedBrands)).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, brand]) => brand);

/** True when the customer buys the brand, ignoring case and spacing. No brand chosen matches everyone. */
export const matchesBrand = (customer: HoReCa, brand: string): boolean => {
  const wanted = compareKey(brand);
  return wanted === '' || customerBrands(customer).some((owned) => compareKey(owned) === wanted);
};

/**
 * The option a chosen brand stands for, or '' (no brand) when none of the options is that
 * brand any more, e.g. after the last buyer was edited.
 */
export const resolveBrand = (options: readonly string[], chosen: string): string =>
  options.find((option) => compareKey(option) === compareKey(chosen)) ?? '';
