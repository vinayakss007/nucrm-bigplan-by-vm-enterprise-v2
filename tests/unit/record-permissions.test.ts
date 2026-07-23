import { describe, it, expect } from 'vitest';
import { getColumnMapping } from '@/lib/rbac/record-permissions';

describe('getColumnMapping', () => {
  it('returns default mapping for unknown entity type', () => {
    const result = getColumnMapping('unknown_entity');
    expect(result).toEqual({
      idColumn: 'id',
      assignedToColumn: 'assigned_to',
      createdByColumn: 'created_by',
    });
  });

  it('returns default mapping for contacts', () => {
    const result = getColumnMapping('contacts');
    expect(result.assignedToColumn).toBe('assigned_to');
    expect(result.createdByColumn).toBe('created_by');
    expect(result.idColumn).toBe('id');
  });

  it('returns correct mapping for deals', () => {
    const result = getColumnMapping('deals');
    expect(result.assignedToColumn).toBe('assigned_to');
    expect(result.createdByColumn).toBe('created_by');
  });

  it('returns correct mapping for companies (owner_id)', () => {
    const result = getColumnMapping('companies');
    expect(result.assignedToColumn).toBe('owner_id');
    expect(result.createdByColumn).toBe('created_by');
  });

  it('returns correct mapping for tickets (assignee_id, reporter_id)', () => {
    const result = getColumnMapping('tickets');
    expect(result.assignedToColumn).toBe('assignee_id');
    expect(result.createdByColumn).toBe('reporter_id');
  });

  it('returns correct mapping for documents (owner_id, uploaded_by)', () => {
    const result = getColumnMapping('documents');
    expect(result.assignedToColumn).toBe('owner_id');
    expect(result.createdByColumn).toBe('uploaded_by');
  });

  it('returns correct mapping for tasks', () => {
    const result = getColumnMapping('tasks');
    expect(result.assignedToColumn).toBe('assigned_to');
    expect(result.createdByColumn).toBe('created_by');
  });

  it('always includes idColumn as id', () => {
    const entities = ['contacts', 'deals', 'companies', 'tickets', 'documents', 'tasks', 'other'];
    for (const entity of entities) {
      const result = getColumnMapping(entity);
      expect(result.idColumn).toBe('id');
    }
  });

  it('returns a new object each call (no shared reference)', () => {
    const a = getColumnMapping('contacts');
    const b = getColumnMapping('contacts');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
