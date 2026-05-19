import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('automation/workflows', () => {
  describe('PREBUILT_WORKFLOWS', () => {
    it('has expected workflows', async () => {
      const { PREBUILT_WORKFLOWS } = await import('@/lib/automation/workflows');
      
      expect(PREBUILT_WORKFLOWS.length).toBeGreaterThan(0);
      expect(PREBUILT_WORKFLOWS[0]).toHaveProperty('id');
      expect(PREBUILT_WORKFLOWS[0]).toHaveProperty('name');
      expect(PREBUILT_WORKFLOWS[0]).toHaveProperty('trigger');
      expect(PREBUILT_WORKFLOWS[0]).toHaveProperty('actions');
    });

    it('each workflow has required structure', async () => {
      const { PREBUILT_WORKFLOWS } = await import('@/lib/automation/workflows');
      
      for (const workflow of PREBUILT_WORKFLOWS) {
        expect(workflow.id).toBeDefined();
        expect(workflow.name).toBeDefined();
        expect(workflow.description).toBeDefined();
        expect(workflow.trigger).toBeDefined();
        expect(workflow.trigger.type).toBeDefined();
        expect(workflow.actions).toBeDefined();
        expect(workflow.actions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getWorkflow', () => {
    it('returns workflow by id', async () => {
      const { getWorkflow } = await import('@/lib/automation/workflows');
      
      const workflow = getWorkflow('welcome-email');
      expect(workflow).toBeDefined();
      expect(workflow?.id).toBe('welcome-email');
    });

    it('returns undefined for non-existent workflow', async () => {
      const { getWorkflow } = await import('@/lib/automation/workflows');
      
      expect(getWorkflow('non-existent')).toBeUndefined();
    });
  });

  describe('getAllWorkflows', () => {
    it('returns all workflows', async () => {
      const { getAllWorkflows } = await import('@/lib/automation/workflows');
      
      const workflows = getAllWorkflows();
      expect(workflows.length).toBeGreaterThan(0);
    });
  });

  describe('getWorkflowsByCategory', () => {
    it('filters by category', async () => {
      const { getWorkflowsByCategory } = await import('@/lib/automation/workflows');
      
      const emailWorkflows = getWorkflowsByCategory('Email');
      expect(emailWorkflows.length).toBeGreaterThan(0);
      emailWorkflows.forEach(w => expect(w.category).toBe('Email'));
    });

    it('returns empty array for unknown category', async () => {
      const { getWorkflowsByCategory } = await import('@/lib/automation/workflows');
      
      const result = getWorkflowsByCategory('NonExistent');
      expect(result).toEqual([]);
    });

    it('finds notification workflows', async () => {
      const { getWorkflowsByCategory } = await import('@/lib/automation/workflows');
      
      const notificationWorkflows = getWorkflowsByCategory('Notifications');
      expect(notificationWorkflows.length).toBeGreaterThan(0);
    });

    it('finds task workflows', async () => {
      const { getWorkflowsByCategory } = await import('@/lib/automation/workflows');
      
      const taskWorkflows = getWorkflowsByCategory('Tasks');
      expect(taskWorkflows.length).toBeGreaterThan(0);
    });
  });

  describe('workflow categories', () => {
    it('has Email category workflows', async () => {
      const { getWorkflowsByCategory } = await import('@/lib/automation/workflows');
      const workflows = getWorkflowsByCategory('Email');
      expect(workflows.some(w => w.id === 'welcome-email')).toBe(true);
    });

    it('has Assignment category workflows', async () => {
      const { getWorkflowsByCategory } = await import('@/lib/automation/workflows');
      const workflows = getWorkflowsByCategory('Assignment');
      expect(workflows.some(w => w.id === 'lead-assignment')).toBe(true);
    });
  });

  describe('workflow triggers', () => {
    it('welcome-email has contact.created trigger', async () => {
      const { getWorkflow } = await import('@/lib/automation/workflows');
      const workflow = getWorkflow('welcome-email');
      expect(workflow?.trigger.type).toBe('contact.created');
    });

    it('task-due-reminder has schedule', async () => {
      const { getWorkflow } = await import('@/lib/automation/workflows');
      const workflow = getWorkflow('task-due-reminder');
      expect(workflow?.trigger.schedule).toBe('0 9 * * *');
    });
  });

  describe('workflow enabled state', () => {
    it('task-due-reminder is enabled by default', async () => {
      const { getWorkflow } = await import('@/lib/automation/workflows');
      const workflow = getWorkflow('task-due-reminder');
      expect(workflow?.enabled).toBe(true);
    });

    it('welcome-email is disabled by default', async () => {
      const { getWorkflow } = await import('@/lib/automation/workflows');
      const workflow = getWorkflow('welcome-email');
      expect(workflow?.enabled).toBe(false);
    });
  });
});

describe('automation/types', () => {
  it('exports Workflow type', async () => {
    const mod = await import('@/lib/automation/types');
    expect(mod).toBeDefined();
  });
});

describe('automation/engine', () => {
  it('exports evaluateAutomations function', async () => {
    const mod = await import('@/lib/automation/engine');
    expect(mod.evaluateAutomations).toBeDefined();
    expect(typeof mod.evaluateAutomations).toBe('function');
  });

  it('exports TriggerEvent type values', async () => {
    const mod = await import('@/lib/automation/engine');
    expect(mod).toBeDefined();
  });
});
