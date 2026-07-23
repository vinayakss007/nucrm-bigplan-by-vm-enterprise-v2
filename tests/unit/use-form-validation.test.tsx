// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormValidation } from '../../lib/hooks/use-form-validation';

describe('useFormValidation', () => {
  const rules = {
    name: { required: true, minLength: 2, maxLength: 50 },
    email: { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    phone: { pattern: /^\d{10}$/ },
    username: { custom: (v: string) => (v === 'admin' ? 'Username taken' : null) },
  };

  it('validates a required field as invalid when empty', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validate('name', '');
    });
    expect(result.current.errors.name).toBe('name is required');
  });

  it('returns no error for unknown rule', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      const err = result.current.validate('nonexistent', 'value');
    });
    expect(result.current.errors.nonexistent).toBeUndefined();
  });

  it('validates minLength', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validate('name', 'A');
    });
    expect(result.current.errors.name).toBe('Must be at least 2 characters');
  });

  it('validates maxLength', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validate('name', 'A'.repeat(51));
    });
    expect(result.current.errors.name).toBe('Must be at most 50 characters');
  });

  it('validates email pattern', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validate('email', 'not-an-email');
    });
    expect(result.current.errors.email).toBe('Please enter a valid email address');
  });

  it('passes email pattern for valid email', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validate('email', 'test@example.com');
    });
    expect(result.current.errors.email).toBeUndefined();
  });

  it('validates custom rule', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validate('username', 'admin');
    });
    expect(result.current.errors.username).toBe('Username taken');
  });

  it('clears error on valid input', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validate('name', '');
    });
    expect(result.current.errors.name).toBeDefined();
    act(() => {
      result.current.validate('name', 'Valid');
    });
    expect(result.current.errors.name).toBeUndefined();
  });

  it('touches a field', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.touch('email');
    });
    expect(result.current.touched.email).toBe(true);
  });

  it('validates all fields with validateAll', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    let valid: boolean;
    act(() => {
      valid = result.current.validateAll({ name: '', email: '', phone: '1234567890' });
    });
    expect(valid!).toBe(false);
    expect(result.current.errors.name).toBe('name is required');
    expect(result.current.errors.email).toBe('email is required');
    expect(result.current.errors.phone).toBeUndefined();
  });

  it('returns true from validateAll when all fields valid', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    let valid: boolean;
    act(() => {
      valid = result.current.validateAll({
        name: 'John',
        email: 'john@example.com',
        phone: '1234567890',
        username: 'john_doe',
      });
    });
    expect(valid!).toBe(true);
    expect(Object.keys(result.current.errors)).toHaveLength(0);
  });

  it('touches all fields after validateAll', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validateAll({ name: 'John', email: 'john@example.com', phone: '1234567890', username: 'john_doe' });
    });
    expect(result.current.touched.name).toBe(true);
    expect(result.current.touched.email).toBe(true);
    expect(result.current.touched.phone).toBe(true);
    expect(result.current.touched.username).toBe(true);
  });

  it('clears all errors with clearErrors', () => {
    const { result } = renderHook(() => useFormValidation(rules));
    act(() => {
      result.current.validate('name', '');
      result.current.validate('email', '');
    });
    expect(Object.keys(result.current.errors).length).toBeGreaterThan(0);
    act(() => {
      result.current.clearErrors();
    });
    expect(Object.keys(result.current.errors)).toHaveLength(0);
    expect(Object.keys(result.current.touched)).toHaveLength(0);
  });

  it('validates pattern on non-email field', () => {
    const localRules = { code: { pattern: /^\d{3}$/ } };
    const { result } = renderHook(() => useFormValidation(localRules));
    act(() => {
      result.current.validate('code', 'abc');
    });
    expect(result.current.errors.code).toBe('Invalid format');
  });
});
