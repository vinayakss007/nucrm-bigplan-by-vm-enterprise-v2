// ── Legacy validation helpers (used by existing tests) ──

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function str(value: unknown, field: string, options?: boolean | { required?: boolean; min?: number; max?: number }): string | null {
  const isRequired = typeof options === 'boolean' ? options : options?.required ?? false;
  const min = typeof options === 'object' ? options.min : undefined;
  const max = typeof options === 'object' ? options.max : undefined;

  if (value == null || (typeof value === 'string' && !value.trim())) {
    if (isRequired) throw new ValidationError(`${field} is required`);
    return null;
  }

  const s = String(value).trim();
  if (min !== undefined && s.length < min) throw new ValidationError(`${field} must be at least ${min} characters`);
  if (max !== undefined && s.length > max) throw new ValidationError(`${field} must be ${max} characters or less`);
  return s;
}

export function email(value: unknown, field?: string | { required?: boolean }, required?: boolean): string | null {
  const fieldName = typeof field === 'string' ? field : 'email';
  const isRequired = typeof field === 'boolean' ? field : required ?? false;

  if (value == null || (typeof value === 'string' && !value.trim())) {
    if (isRequired) throw new ValidationError(`${fieldName} is required`);
    return null;
  }

  const s = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new ValidationError(`not a valid email address`);
  return s;
}

export function num(value: unknown, field: string, options?: boolean | { required?: boolean; min?: number; max?: number }): number | null {
  const isRequired = typeof options === 'boolean' ? options : options?.required ?? false;
  const min = typeof options === 'object' ? options.min : undefined;
  const max = typeof options === 'object' ? options.max : undefined;

  if (value == null || value === '') {
    if (isRequired) throw new ValidationError(`${field} is required`);
    return null;
  }

  const n = typeof value === 'number' ? value : Number(value);
  if (isNaN(n)) throw new ValidationError(`${field} must be a number`);
  if (min !== undefined && n < min) throw new ValidationError(`${field} must be at least ${min}`);
  if (max !== undefined && n > max) throw new ValidationError(`${field} must be ${max} or less`);
  return n;
}

export function enumVal<T extends string>(value: unknown, field: string, options: readonly T[], required = false): T | null {
  const s = str(value, field, required);
  if (s == null) return null;
  if (!options.includes(s as T)) throw new ValidationError(`${field} must be one of: ${options.join(', ')}`);
  return s as T;
}

export function validationResponse(err: unknown): { error: string; status: number } | null {
  if (err instanceof ValidationError) return { error: err.message, status: err.status };
  return null;
}

// ── New validation schemas (for API input validation) ──

export type ValidationRule = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  email?: boolean;
  message?: string;
};

export type ValidationSchema = Record<string, ValidationRule>;

export type ValidationErrors = Record<string, string>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validate(data: Record<string, any>, schema: ValidationSchema): ValidationErrors | null {
  const errors: ValidationErrors = {};

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    if (rules.required && (!value || (typeof value === 'string' && !value.trim()))) {
      errors[field] = rules.message || `${field} is required`;
      continue;
    }

    if (!value && !rules.required) continue;

    if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
      errors[field] = `${field} must be at least ${rules.minLength} characters`;
    }

    if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
      errors[field] = `${field} must be at most ${rules.maxLength} characters`;
    }

    if (rules.email && typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field] = rules.message || 'Invalid email address';
    }

    if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
      errors[field] = rules.message || `${field} has invalid format`;
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

export const contactSchema: ValidationSchema = {
  first_name: { required: true, maxLength: 100 },
  email: { email: true, maxLength: 255 },
  phone: { pattern: /^[\d\s\-+()]{0,20}$/, message: 'Invalid phone number' },
};

export const dealSchema: ValidationSchema = {
  title: { required: true, maxLength: 200 },
};

export const taskSchema: ValidationSchema = {
  title: { required: true, maxLength: 200 },
};

export const companySchema: ValidationSchema = {
  name: { required: true, maxLength: 200 },
  website: { maxLength: 500 },
};

export const ticketSchema: ValidationSchema = {
  subject: { required: true, maxLength: 300 },
};
