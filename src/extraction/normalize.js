function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeNumericMeasurement({ value, unit }) {
  const originalValue = String(value ?? "").trim();
  const originalUnit = String(unit ?? "").trim() || null;
  const number = numericValue(value);
  if (number === null) {
    return {
      originalValue,
      originalUnit,
      normalizedValue: null,
      normalizedUnit: null,
      status: "not_normalized",
    };
  }

  const unitKey = originalUnit?.toLocaleLowerCase("en-US").replaceAll(" ", "") ?? "";
  if (["%", "percent", "percentage"].includes(unitKey)) {
    return {
      originalValue,
      originalUnit,
      normalizedValue: number / 100,
      normalizedUnit: "fraction",
      status: "normalized",
    };
  }
  if (["fraction", "mg/l", "ppm", "ml/min", "l/min"].includes(unitKey)) {
    return {
      originalValue,
      originalUnit,
      normalizedValue: number,
      normalizedUnit: unitKey === "mg/l" ? "mg/L" : unitKey,
      status: "normalized",
    };
  }
  return {
    originalValue,
    originalUnit,
    normalizedValue: number,
    normalizedUnit: originalUnit,
    status: "preserved_without_conversion",
  };
}

