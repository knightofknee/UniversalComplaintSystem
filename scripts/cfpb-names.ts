/** The CFPB lists companies by legal name, often in capitals; people read them by their usual name. */
const CFPB_NAMES: Record<string, string> = {
  'EXPERIAN INFORMATION SOLUTIONS INC.': 'Experian',
  'TRANSUNION INTERMEDIATE HOLDINGS, INC.': 'TransUnion',
  'EQUIFAX, INC.': 'Equifax',
  'WELLS FARGO & COMPANY': 'Wells Fargo',
  'JPMORGAN CHASE & CO.': 'JPMorgan Chase',
  'CITIBANK, N.A.': 'Citibank',
  'BANK OF AMERICA, NATIONAL ASSOCIATION': 'Bank of America',
  'CAPITAL ONE FINANCIAL CORPORATION': 'Capital One',
  'SYNCHRONY FINANCIAL': 'Synchrony',
  'COINBASE, INC.': 'Coinbase',
  'NAVIENT SOLUTIONS, LLC.': 'Navient',
};
export function readableCompany(name: string) {
  const known = CFPB_NAMES[name.toUpperCase()];
  if (known) return known;
  if (name !== name.toUpperCase()) return name;
  // Unknown and all capitals: drop the legal suffix and set it in title case.
  return name
    .replace(/,?\s+(INC|LLC|L\.L\.C|CORP|CORPORATION|CO|COMPANY|N\.A|NATIONAL ASSOCIATION)\.?$/i, '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
