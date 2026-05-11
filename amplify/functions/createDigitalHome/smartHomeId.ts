// SmartHome ID format: {country}-{postalCode}-{streetCode}{houseNumber}-{suffix}
// e.g. DE-80331-MAR12-01

export interface SmartHomeIdParts {
  country: string;
  postalCode: string;
  streetCode: string;
  houseNumber: string;
  suffix: string;
}

const SMARTHOME_ID_REGEX = /^[A-Z]{2}-\d{3,5}-[A-Z]{3}\d{1,5}-\d{2}$/;

export function computeSmartHomeId(parts: SmartHomeIdParts): string {
  return `${parts.country.toUpperCase()}-${parts.postalCode}-${parts.streetCode.toUpperCase()}${parts.houseNumber}-${parts.suffix}`;
}

export function validateSmartHomeId(id: string): { valid: boolean; error?: string } {
  if (!id || typeof id !== "string") {
    return { valid: false, error: "SmartHome ID is required." };
  }
  if (!SMARTHOME_ID_REGEX.test(id.trim().toUpperCase())) {
    return {
      valid: false,
      error:
        "Invalid format. Expected: CC-POSTALCODE-STR##-NN (e.g. DE-80331-MAR12-01)",
    };
  }
  return { valid: true };
}

export function validateParts(
  parts: SmartHomeIdParts
): { valid: boolean; error?: string } {
  if (!/^[A-Z]{2}$/.test(parts.country)) {
    return { valid: false, error: "country must be a 2-letter ISO code (uppercase)" };
  }
  if (!/^\d{3,5}$/.test(parts.postalCode)) {
    return { valid: false, error: "postalCode must be 3–5 digits" };
  }
  if (!/^[A-Z]{3}$/.test(parts.streetCode)) {
    return { valid: false, error: "streetCode must be 3 uppercase letters" };
  }
  if (!/^\d{1,5}$/.test(parts.houseNumber)) {
    return { valid: false, error: "houseNumber must be 1–5 digits" };
  }
  if (!/^\d{2}$/.test(parts.suffix)) {
    return { valid: false, error: "suffix must be 2 digits" };
  }
  return { valid: true };
}
