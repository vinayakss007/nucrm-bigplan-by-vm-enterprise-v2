import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  notifications: {
    userId: 'user_id',
    tenantId: 'tenant_id',
    type: 'type',
    title: 'title',
    body: 'body',
    link: 'link',
    metadata: 'metadata',
  },
  tenantMembers: {
    userId: 'user_id',
    tenantId: 'tenant_id',
    status: 'status',
  },
  users: {
    id: 'id',
    fullName: 'full_name',
    email: 'email',
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  ne: vi.fn((...args: unknown[]) => args),
  ilike: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  sql: vi.fn((...args: unknown[]) => args),
}));

import { db } from '@/drizzle/db';
import { logger } from '@/lib/logger';

describe('notifications', () => {
  let createNotification: any;
  let notifyTenantMembers: any;
  let processMentions: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('createNotification', () => {
    beforeEach(async () => {
      const mod = await import('@/lib/notifications');
      createNotification = mod.createNotification;
    });

    it('inserts a notification with all fields', async () => {
      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await createNotification({
        userId: 'user-1',
        tenantId: 'tenant-1',
        type: 'task_assigned',
        title: 'Task assigned to you',
        body: 'Please review the proposal',
        link: '/tenant/tasks/123',
      });

      expect(db.insert).toHaveBeenCalled();
      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          tenantId: 'tenant-1',
          type: 'task_assigned',
          title: 'Task assigned to you',
        }),
      );
    });

    it('auto-derives link from entity_type and entity_id', async () => {
      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await createNotification({
        userId: 'user-1',
        tenantId: 'tenant-1',
        type: 'deal_stage',
        title: 'Deal moved',
        entity_type: 'deal',
        entity_id: 'deal-42',
      });

      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          link: '/tenant/deals/deal-42',
        }),
      );
    });

    it('stores entity ref in metadata', async () => {
      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await createNotification({
        userId: 'user-1',
        tenantId: 'tenant-1',
        type: 'contact_assigned',
        title: 'Contact assigned',
        entity_type: 'contact',
        entity_id: 'contact-7',
      });

      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            entity_type: 'contact',
            entity_id: 'contact-7',
          }),
        }),
      );
    });

    it('truncates title to 200 chars', async () => {
      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);
      const longTitle = 'x'.repeat(300);

      await createNotification({
        userId: 'user-1',
        tenantId: 'tenant-1',
        type: 'system',
        title: longTitle,
      });

      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          title: longTitle.slice(0, 200),
        }),
      );
    });

    it('truncates body to 500 chars', async () => {
      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);
      const longBody = 'x'.repeat(600);

      await createNotification({
        userId: 'user-1',
        tenantId: 'tenant-1',
        type: 'system',
        title: 'Test',
        body: longBody,
      });

      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: longBody.slice(0, 500),
        }),
      );
    });

    it('defaults body to empty string when not provided', async () => {
      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await createNotification({
        userId: 'user-1',
        tenantId: 'tenant-1',
        type: 'system',
        title: 'Test',
      });

      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({ body: '' }),
      );
    });

    it('handles db insert errors gracefully', async () => {
      vi.mocked(db.insert).mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      await expect(
        createNotification({
          userId: 'user-1',
          tenantId: 'tenant-1',
          type: 'system',
          title: 'Test',
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        '[notifications] Failed to create notification',
        expect.objectContaining({ error: 'DB connection lost' }),
      );
    });

    it('supports all notification types', async () => {
      const types = [
        'task_assigned', 'task_due', 'task_overdue',
        'deal_stage', 'deal_assigned', 'deal_won',
        'contact_assigned', 'mention',
        'invite_accepted', 'team_joined',
        'limit_warning', 'trial_expiring',
        'lead_warming', 'system',
      ] as const;
      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      for (const type of types) {
        await createNotification({
          userId: 'u-1',
          tenantId: 't-1',
          type,
          title: type,
        });
      }

      expect(valuesFn).toHaveBeenCalledTimes(types.length);
    });
  });

  describe('notifyTenantMembers', () => {
    beforeEach(async () => {
      const mod = await import('@/lib/notifications');
      notifyTenantMembers = mod.notifyTenantMembers;
    });

    it('inserts notifications for all active tenant members', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { userId: 'member-1' },
            { userId: 'member-2' },
            { userId: 'member-3' },
          ]),
        })),
      } as any);

      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await notifyTenantMembers({
        tenantId: 'tenant-1',
        type: 'team_joined',
        title: 'New member joined!',
      });

      expect(valuesFn).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ userId: 'member-1' }),
          expect.objectContaining({ userId: 'member-2' }),
          expect.objectContaining({ userId: 'member-3' }),
        ]),
      );
    });

    it('excludes specified userId from notification', async () => {
      const whereFn = vi.fn().mockResolvedValue([
        { userId: 'member-1' },
        { userId: 'member-2' },
      ]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: whereFn,
        })),
      } as any);

      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await notifyTenantMembers({
        tenantId: 'tenant-1',
        excludeUserId: 'user-admin',
        type: 'team_joined',
        title: 'Welcome!',
      });

      expect(whereFn).toHaveBeenCalled();
    });

    it('returns early when no active members found', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      } as any);

      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await notifyTenantMembers({
        tenantId: 'tenant-1',
        type: 'system',
        title: 'No one to notify',
      });

      expect(valuesFn).not.toHaveBeenCalled();
    });

    it('auto-derives link from entity for bulk notifications', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { userId: 'member-1' },
          ]),
        })),
      } as any);

      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await notifyTenantMembers({
        tenantId: 'tenant-1',
        type: 'contact_assigned',
        title: 'New contact',
        entity_type: 'company',
        entity_id: 'company-5',
      });

      expect(valuesFn).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            link: '/tenant/companies/company-5',
          }),
        ]),
      );
    });

    it('handles db error gracefully', async () => {
      vi.mocked(db.select).mockImplementation(() => {
        throw new Error('select failed');
      });

      await expect(
        notifyTenantMembers({
          tenantId: 'tenant-1',
          type: 'system',
          title: 'Error test',
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        '[notifications] Failed to notify tenant members',
        expect.any(Object),
      );
    });
  });

  describe('processMentions', () => {
    beforeEach(async () => {
      const mod = await import('@/lib/notifications');
      processMentions = mod.processMentions;
    });

    it('parses @mentions and creates notifications', async () => {
      const whereFn = vi.fn().mockResolvedValue([{ id: 'mentioned-user' }]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: whereFn,
            })),
          })),
        })),
      } as any);

      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await processMentions(
        'Hey @john, check this out!',
        'tenant-1',
        'author-1',
        '/tenant/tasks/1',
      );

      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'mentioned-user',
          type: 'mention',
          title: 'You were mentioned',
        }),
      );
    });

    it('returns early when no mentions in text', async () => {
      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await processMentions(
        'This text has no mentions',
        'tenant-1',
        'author-1',
      );

      expect(valuesFn).not.toHaveBeenCalled();
    });

    it('skips mention when no user matches', async () => {
      const whereFn = vi.fn().mockResolvedValue([]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: whereFn,
            })),
          })),
        })),
      } as any);

      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await processMentions(
        'Hello @unknownuser',
        'tenant-1',
        'author-1',
      );

      expect(valuesFn).not.toHaveBeenCalled();
    });

    it('handles multiple mentions in one text', async () => {
      let callCount = 0;
      const limitFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [{ id: 'user-1' }];
        return [{ id: 'user-2' }];
      });

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: limitFn,
            })),
          })),
        })),
      } as any);

      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await processMentions(
        'Hi @alice and @bob!',
        'tenant-1',
        'author-1',
      );

      expect(valuesFn).toHaveBeenCalledTimes(2);
    });

    it('handles db error for individual mention gracefully', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockRejectedValue(new Error('db error')),
            })),
          })),
        })),
      } as any);

      const valuesFn = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ values: valuesFn } as any);

      await expect(
        processMentions('Hello @testuser', 'tenant-1', 'author-1'),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        '[notifications] Failed to process mention',
        expect.any(Object),
      );
    });
  });
});
