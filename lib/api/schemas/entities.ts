import { z } from 'zod';

const uuid = z.string().uuid().optional().nullable();
const requiredString = z.string().trim().min(1);

// ── Task schemas ──
export const createTaskSchema = z.object({
  title: requiredString.max(300),
  description: z.string().max(5000).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  assigneeId: uuid,
  contactId: uuid,
  dealId: uuid,
  companyId: uuid,
  tags: z.array(z.string().max(50)).optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

export const taskQuerySchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  assignee_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  due_before: z.string().datetime().optional(),
  due_after: z.string().datetime().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Ticket schemas ──
export const createTicketSchema = z.object({
  subject: requiredString.max(300),
  description: z.string().max(10000).optional(),
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  category: z.string().max(100).optional(),
  contactId: uuid,
  assignedTo: uuid,
  tags: z.array(z.string().max(50)).optional(),
});

export const updateTicketSchema = createTicketSchema.partial();

export const ticketQuerySchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  contact_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ticketReplySchema = z.object({
  message: requiredString.max(10000),
  isInternal: z.boolean().optional(),
});

// ── Meeting schemas ──
export const createMeetingSchema = z.object({
  title: requiredString.max(200),
  description: z.string().max(5000).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  location: z.string().max(500).optional(),
  attendees: z.array(z.string().email()).optional(),
  contactId: uuid,
  dealId: uuid,
  calendarId: z.string().max(100).optional(),
});

export const updateMeetingSchema = createMeetingSchema.partial();

// ── Note schemas ──
export const createNoteSchema = z.object({
  content: requiredString.max(10000),
  contactId: uuid,
  dealId: uuid,
  companyId: uuid,
});

export const updateNoteSchema = createNoteSchema.partial();

// ── Pipeline schemas ──
export const createPipelineSchema = z.object({
  name: requiredString.max(100),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
});

export const updatePipelineSchema = createPipelineSchema.partial();

// ── Deal Stage schemas ──
export const createDealStageSchema = z.object({
  name: requiredString.max(100),
  pipelineId: uuid,
  position: z.number().int().min(0).optional(),
  probability: z.number().min(0).max(100).optional(),
  color: z.string().max(7).optional(),
  winProbability: z.number().int().min(0).max(100).optional(),
});

export const updateDealStageSchema = createDealStageSchema.partial();

// ── Project schemas ──
export const createProjectSchema = z.object({
  name: requiredString.max(200),
  description: z.string().max(5000).optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  budget: z.number().min(0).optional(),
  contactId: uuid,
  assigneeId: uuid,
  tags: z.array(z.string().max(50)).optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const createMilestoneSchema = z.object({
  name: requiredString.max(200),
  projectId: uuid,
  dueDate: z.string().datetime().optional().nullable(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
});

export const linkTaskSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
});
