import { useState, useCallback } from 'react';

export type ValidationRule = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: (value: string) => string | null;
};

export type ValidationRules = Record<string, ValidationRule>;

export type ValidationErrors = Record<string, string>;

export function useFormValidation(rules: ValidationRules) {
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validateField = useCallback((name: string, value: string): string | null => {
    const rule = rules[name];
    if (!rule) return null;

    if (rule.required && !value.trim()) {
      return `${name.replace(/_/g, ' ')} is required`;
    }

    if (rule.minLength && value.length < rule.minLength) {
      return `Must be at least ${rule.minLength} characters`;
    }

    if (rule.maxLength && value.length > rule.maxLength) {
      return `Must be at most ${rule.maxLength} characters`;
    }

    if (rule.pattern && value && !rule.pattern.test(value)) {
      if (name.includes('email')) return 'Please enter a valid email address';
      return 'Invalid format';
    }

    if (rule.custom && value) {
      return rule.custom(value);
    }

    return null;
  }, [rules]);

  const validate = useCallback((name: string, value: string) => {
    const error = validateField(name, value);
    setErrors(prev => {
      const next = { ...prev };
      if (error) {
        next[name] = error;
      } else {
        delete next[name];
      }
      return next;
    });
    return error;
  }, [validateField]);

  const touch = useCallback((name: string): boolean => {
    setTouched(prev => ({ ...prev, [name]: true }));
    return true;
  }, []);

  const validateAll = useCallback((values: Record<string, string>): boolean => {
    const newErrors: ValidationErrors = {};
    let valid = true;

    for (const [name, rule] of Object.entries(rules)) {
      const value = values[name] || '';
      const error = validateField(name, value);
      if (error) {
        newErrors[name] = error;
        valid = false;
      }
    }

    setErrors(newErrors);
    setTouched(
      Object.fromEntries(Object.keys(rules).map(k => [k, true]))
    );
    return valid;
  }, [rules, validateField]);

  const clearErrors = useCallback(() => {
    setErrors({});
    setTouched({});
  }, []);

  return { errors, touched, validate, touch, validateAll, clearErrors };
}
