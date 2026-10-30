const sanitizeString = (str: unknown): unknown => {
  if (typeof str !== "string") return str;
  return str.trim().split("").filter((char) => {
    const code = char.charCodeAt(0);
    return !(code <= 8 || code === 11 || code === 12 ||
      (code >= 14 && code <= 31) || code === 127);
  }).join("");
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
