import { z } from 'zod';
import { uuid, requiredString } from './common';

// ── Project schemas ──
export const createProjectSchema = z.object({
  name: requiredString.max(200, 'Name too long'),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'on-hold', 'completed']).optional().default('active'),
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
  owner_id: uuid,
});

export const updateProjectSchema = createProjectSchema.partial();

// ── Milestone schemas ──
export const createMilestoneSchema = z.object({
  title: requiredString.max(200, 'Title too long'),
  due_date: z.string().date().optional().nullable(),
  project_id: z.string().uuid(),
});

// ── Link Task schema ──
export const linkTaskSchema = z.object({
  task_id: z.string().uuid(),
});

// ── Type exports ──
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type LinkTaskInput = z.infer<typeof linkTaskSchema>;
