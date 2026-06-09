import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockFindFirst = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    update: (...args: any[]) => mockUpdate(...args),
    select: (...args: any[]) => mockSelect(...args),
    query: {
      chatSessions: { findFirst: (...args: any[]) => mockFindFirst(...args) },
    },
  },
}));

vi.mock('@/drizzle/schema/chat', () => ({
  chatSessions: {
    id: 'id', tenantId: 'tenant_id', status: 'status',
    visitorId: 'visitor_id', assignedTo: 'assigned_to',
    convertedLeadId: 'converted_lead_id', createdAt: 'created_at',
  },
  chatMessages: {
    id: 'id', sessionId: 'session_id', tenantId: 'tenant_id',
    createdAt: 'created_at', content: 'content', senderType: 'sender_type',
  },
}));

vi.mock('@/drizzle/schema', () => ({
  contacts: { id: 'id', tenantId: 'tenant_id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => ['eq', ...args]),
  and: vi.fn((...args: any[]) => ['and', ...args]),
  desc: vi.fn((col: any) => ['desc', col]),
  ne: vi.fn((...args: any[]) => ['ne', ...args]),
  sql: vi.fn(),
}));

import {
  createChatSession,
  sendMessage,
  assignAgent,
  closeChatSession,
  convertChatToLead,
  getSessionMessages,
} from '@/lib/chat';

describe('Chat - createChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new session with waiting status', async () => {
    const mockSession = {
      id: 'session-1', tenantId: 'tenant-1', visitorId: 'visitor-1',
      visitorName: 'Test User', visitorEmail: 'test@example.com',
      status: 'waiting', channel: 'web',
    };

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockSession]),
      }),
    });

    const result = await createChatSession({
      visitorId: 'visitor-1', tenantId: 'tenant-1',
      visitorName: 'Test User', visitorEmail: 'test@example.com',
    });

    expect(result).toEqual(mockSession);
    expect(result.status).toBe('waiting');
    expect(mockInsert).toHaveBeenCalled();
  });

  it('creates session with default channel when not specified', async () => {
    const mockSession = {
      id: 'session-2', tenantId: 'tenant-1', visitorId: 'visitor-2',
      status: 'waiting', channel: 'web',
    };

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockSession]),
      }),
    });

    const result = await createChatSession({
      visitorId: 'visitor-2', tenantId: 'tenant-1',
    });

    expect(result.channel).toBe('web');
  });

  it('creates session with custom channel', async () => {
    const mockSession = {
      id: 'session-3', tenantId: 'tenant-1', visitorId: 'visitor-3',
      status: 'waiting', channel: 'mobile',
    };

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockSession]),
      }),
    });

    const result = await createChatSession({
      visitorId: 'visitor-3', tenantId: 'tenant-1', channel: 'mobile',
    });

    expect(result.channel).toBe('mobile');
  });

  it('defaults visitorName and visitorEmail to null when not provided', async () => {
    const mockSession = {
      id: 'session-4', tenantId: 'tenant-1', visitorId: 'visitor-4',
      visitorName: null, visitorEmail: null, status: 'waiting', channel: 'web',
    };

    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockSession]),
      }),
    });

    const result = await createChatSession({
      visitorId: 'visitor-4', tenantId: 'tenant-1',
    });

    expect(result.visitorName).toBeNull();
    expect(result.visitorEmail).toBeNull();
  });
});

describe('Chat - sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends message successfully in active session', async () => {
    mockFindFirst.mockResolvedValue({ id: 'session-1', status: 'active' });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-1', content: 'Hello', senderType: 'visitor' }]),
      }),
    });

    const result = await sendMessage({
      sessionId: 'session-1', tenantId: 'tenant-1',
      content: 'Hello', senderType: 'visitor',
    });

    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
  });

  it('rejects message when session is closed', async () => {
    mockFindFirst.mockResolvedValue({ id: 'session-1', status: 'closed' });

    const result = await sendMessage({
      sessionId: 'session-1', tenantId: 'tenant-1',
      content: 'Hello', senderType: 'visitor',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session is closed');
  });

  it('returns error when session not found', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await sendMessage({
      sessionId: 'non-existent', tenantId: 'tenant-1',
      content: 'Hello', senderType: 'visitor',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session not found');
  });

  it('sends agent message and moves waiting session to active', async () => {
    mockFindFirst.mockResolvedValue({ id: 'session-1', status: 'waiting' });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-1', content: 'Hi there!', senderType: 'agent' }]),
      }),
    });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await sendMessage({
      sessionId: 'session-1', tenantId: 'tenant-1',
      content: 'Hi there!', senderType: 'agent',
    });

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('sends message with optional senderId', async () => {
    mockFindFirst.mockResolvedValue({ id: 'session-1', status: 'active' });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-1', senderId: 'agent-1' }]),
      }),
    });

    const result = await sendMessage({
      sessionId: 'session-1', tenantId: 'tenant-1',
      content: 'Hello', senderType: 'agent', senderId: 'agent-1',
    });

    expect(result.success).toBe(true);
  });
});

describe('Chat - assignAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns agent and sets status to active', async () => {
    mockFindFirst.mockResolvedValue({ id: 'session-1', status: 'waiting' });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await assignAgent('session-1', 'agent-1', 'tenant-1');

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('returns error when session not found', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await assignAgent('non-existent', 'agent-1', 'tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session not found');
  });
});

describe('Chat - closeChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes an active session', async () => {
    mockFindFirst.mockResolvedValue({ id: 'session-1' });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await closeChatSession('session-1', 'tenant-1');

    expect(result.success).toBe(true);
  });

  it('returns error when session not found', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await closeChatSession('non-existent', 'tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session not found');
  });
});

describe('Chat - convertChatToLead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts session to lead contact', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'session-1', visitorName: 'Jane Doe', visitorEmail: 'jane@example.com', convertedLeadId: null,
    });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'contact-1' }]),
      }),
    });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await convertChatToLead('session-1', 'tenant-1');

    expect(result.success).toBe(true);
    expect(result.leadId).toBe('contact-1');
  });

  it('rejects conversion if already converted', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'session-1', convertedLeadId: 'existing-contact-1',
    });

    const result = await convertChatToLead('session-1', 'tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session already converted');
    expect(result.leadId).toBe('existing-contact-1');
  });

  it('returns error when session not found', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await convertChatToLead('non-existent', 'tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session not found');
  });

  it('uses default name when visitorName is missing', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'session-1', visitorName: null, visitorEmail: null, convertedLeadId: null,
    });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'contact-2' }]),
      }),
    });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await convertChatToLead('session-1', 'tenant-1');

    expect(result.success).toBe(true);
  });
});

describe('Chat - getSessionMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns messages for a session', async () => {
    const mockMessages = [
      { id: 'msg-1', content: 'Hello', sessionId: 'session-1' },
      { id: 'msg-2', content: 'Hi!', sessionId: 'session-1' },
    ];
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockMessages),
          }),
        }),
      }),
    });

    const result = await getSessionMessages('session-1', 'tenant-1');

    expect(result).toEqual(mockMessages);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no messages', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const result = await getSessionMessages('session-1', 'tenant-1');

    expect(result).toEqual([]);
  });

  it('respects custom limit', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    await getSessionMessages('session-1', 'tenant-1', 10);

    const limitFn = mockSelect.mock.results[0]?.value
      .from.mock.results[0]?.value
      .where.mock.results[0]?.value
      .orderBy.mock.results[0]?.value
      .limit;

    expect(limitFn).toHaveBeenCalledWith(10);
  });
});
