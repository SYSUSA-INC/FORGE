export type ValidationResult = string | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
// Accept common US phone formats: +1, parens, dashes, dots, spaces
// Examples: (202) 800-6042, 202-800-6042, +1 202 800 6042, 2028006042
const PHONE_DIGITS_RE = /^[0-9+\-()\s.]+$/;

export function validateEmail(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length > 254) return "Email too long.";
  if (!EMAIL_RE.test(trimmed)) return "Enter a valid email address.";
  return null;
}

export function validatePhone(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (!PHONE_DIGITS_RE.test(trimmed)) {
    return "Phone can only contain digits, spaces, and + - ( ) .";
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10) return "Phone number must have at least 10 digits.";
  if (digits.length > 15) return "Phone number is too long.";
  return null;
}

export function validateWebsite(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (!URL_RE.test(trimmed)) {
    return "Enter a full URL starting with http:// or https://";
  }
  return null;
}

export function validateUei(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length !== 12) return "UEI must be exactly 12 characters.";
  if (!/^[A-Z0-9]+$/.test(trimmed.toUpperCase()))
    return "UEI must be letters and numbers only.";
  return null;
}

export function validateCage(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length !== 5) return "CAGE code must be exactly 5 characters.";
  if (!/^[A-Z0-9]+$/.test(trimmed.toUpperCase()))
    return "CAGE must be letters and numbers only.";
  return null;
}

export function validateDuns(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== 9) return "DUNS must be 9 digits.";
  return null;
}

export function validateZip(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (!/^\d{5}(-\d{4})?$/.test(trimmed))
    return "ZIP must be 5 digits, optionally +4 (e.g., 20001 or 20001-1234).";
  return null;
}

export function validateState(v: string, country: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const isUS = !country || /^(us|usa|united states)$/i.test(country.trim());
  if (isUS) {
    if (!/^[A-Za-z]{2}$/.test(trimmed))
      return "US state must be a 2-letter code (e.g., VA, DC, CA).";
  } else if (trimmed.length > 64) {
    return "State/region too long.";
  }
  return null;
}

export function validateCity(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length < 2) return "City name is too short.";
  if (trimmed.length > 128) return "City name is too long.";
  return null;
}

export function validateAddressLine(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) return "Address line too long.";
  return null;
}

export function validateCountry(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length > 64) return "Country name too long.";
  return null;
}

export function validateNaics(v: string): ValidationResult {
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (!/^\d{6}$/.test(trimmed)) return "NAICS must be 6 digits.";
  return null;
}

export type OrgProfileErrors = {
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  uei?: string | null;
  cageCode?: string | null;
  dunsNumber?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  primaryNaics?: string | null;
};

export function validateOrgProfile(p: {
  website: string;
  email: string;
  phone: string;
  uei: string;
  cageCode: string;
  dunsNumber: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  primaryNaics: string;
}): OrgProfileErrors {
  return {
    website: validateWebsite(p.website),
    email: validateEmail(p.email),
    phone: validatePhone(p.phone),
    uei: validateUei(p.uei),
    cageCode: validateCage(p.cageCode),
    dunsNumber: validateDuns(p.dunsNumber),
    addressLine1: validateAddressLine(p.address.line1),
    addressLine2: validateAddressLine(p.address.line2),
    city: validateCity(p.address.city),
    state: validateState(p.address.state, p.address.country),
    zip: validateZip(p.address.zip),
    country: validateCountry(p.address.country),
    primaryNaics: validateNaics(p.primaryNaics),
  };
}

export function hasErrors(errors: OrgProfileErrors): boolean {
  return Object.values(errors).some((v) => typeof v === "string" && v.length > 0);
}
