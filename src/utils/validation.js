export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

export class NotFoundError extends Error {
  constructor(message = "Study not found", code = "study_not_found") {
    super(message);
    this.name = "NotFoundError";
    this.code = code;
  }
}

export function optionalText(value, field, maxLength = 200) {
  if (value === null || value === undefined || value === "") return undefined;
  const text = String(value).trim();
  if (!text || text.length > maxLength) {
    throw new ValidationError(`${field} must contain 1–${maxLength} characters`, field);
  }
  return text;
}

export function optionalEnum(value, field, allowed) {
  const text = optionalText(value, field, 80);
  if (text === undefined) return undefined;
  if (!allowed.includes(text)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`, field);
  }
  return text;
}

export function optionalInteger(value, field, { min, max } = {}) {
  if (value === null || value === undefined || value === "") return undefined;
  if (!/^-?\d+$/.test(String(value))) {
    throw new ValidationError(`${field} must be an integer`, field);
  }
  const number = Number(value);
  if ((min !== undefined && number < min) || (max !== undefined && number > max)) {
    throw new ValidationError(`${field} must be between ${min} and ${max}`, field);
  }
  return number;
}

export function optionalBoolean(value, field) {
  if (value === null || value === undefined || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new ValidationError(`${field} must be true or false`, field);
}

export function validatePublicId(value) {
  const publicId = optionalText(value, "publicId", 80);
  if (!publicId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(publicId)) {
    throw new ValidationError("publicId has an invalid format", "publicId");
  }
  return publicId;
}
