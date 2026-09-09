const sanitizeString = (str: unknown): unknown => {
  if (typeof str !== "string") return str;
  // eslint-disable-next-line no-control-regex
  return str.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
};

export const sanitizeObject = (obj: unknown): unknown => {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === "string" ?
        sanitizeString(item) :
        typeof item === "object" && item !== null ?
          sanitizeObject(item) :
          item,
    );
  }
  const sanitized: Record<string, unknown> = {
    ...(obj as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string") {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === "string" ?
          sanitizeString(item) :
          typeof item === "object" && item !== null ?
            sanitizeObject(item) :
            item,
      );
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeObject(value);
    }
  }
  return sanitized;
};
