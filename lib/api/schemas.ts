export {
  // CRM
  createContactSchema, updateContactSchema, contactQuerySchema,
  createLeadSchema, updateLeadSchema, leadQuerySchema,
  createDealSchema, updateDealSchema, dealQuerySchema,
  createCompanySchema, updateCompanySchema, companyQuerySchema,
} from './schemas/crm';

export {
  // Financial
  createInvoiceSchema, updateInvoiceSchema, invoiceQuerySchema,
  createQuoteSchema, updateQuoteSchema,
  createOrderSchema, updateOrderSchema,
  createContractSchema, updateContractSchema,
  createSubscriptionSchema, updateSubscriptionSchema,
} from './schemas/financial';

export {
  // Entities
  createTaskSchema, updateTaskSchema, taskQuerySchema,
  createTicketSchema, updateTicketSchema, ticketQuerySchema, ticketReplySchema,
  createMeetingSchema, updateMeetingSchema,
  createNoteSchema, updateNoteSchema,
  createPipelineSchema, updatePipelineSchema,
  createDealStageSchema, updateDealStageSchema,
  createProjectSchema, updateProjectSchema,
  createMilestoneSchema, linkTaskSchema,
} from './schemas/entities';

export {
  // Admin / Settings / Superadmin / Automation
  createAnnouncementSchema, updateAnnouncementSchema, deleteAnnouncementSchema,
  setSystemKeySchema, updateRateLimitsSchema,
  updateAiProvidersSchema,
  createLeadScoringRuleSchema, updateLeadScoringRuleSchema,
  createAiTemplateSchema,
  createHierarchySchema, updateHierarchySchema, deleteHierarchySchema,
  createAutomationSchema, updateAutomationSchema,
  createWorkflowSchema,
  createSequenceSchema, updateSequenceSchema,
  createWebhookSchema, updateWebhookSchema,
  createApiKeySchema,
  createFormSchema, updateFormSchema,
  createEmailTemplateSchema, updateEmailTemplateSchema,
  createRoleSchema, updateRoleSchema,
  inviteMemberSchema,
  bulkDeleteSchema, bulkUpdateSchema,
  exportSchema, importSchema, searchSchema,
  createKbArticleSchema, createKbCategorySchema,
  createIntegrationSchema,
  createServiceSchema,
  createProductSchema,
  enable2faSchema, verify2faSchema,
  updateNotificationPrefsSchema,
  changePasswordSchema,
  updateProfileSchema,
  updateTenantSettingsSchema,
  createScheduledReportSchema,
  createBackupSchema, backupConfigSchema,
  createCustomFieldSchema, updateCustomFieldSchema,
  mergeContactSchema, convertLeadSchema,
  triggerWorkflowSchema,
  sendWhatsAppSchema, testEmailSchema,
  publicLeadCaptureSchema, publicFormSubmitSchema,
  ipWhitelistSchema, emailWarmupConfigSchema,
  onboardingStepSchema, aiAssistantSchema,
  assignContactSchema, updateMemberSchema,
  updateTelegramSchema, checkoutSessionSchema,
  createPlanSchema, updatePlanSchema,
  createTenantSchema, updateTenantSchema,
  platformSettingsSchema,
  createFollowUpSchema, updateFollowUpSchema, followUpQuerySchema,
  atRiskRuleSchema, updateAtRiskRuleSchema,
  signupSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema,
  tagActionSchema, upsertPicklistSchema, preferencesPatchSchema,
} from './schemas/admin';

// ── Type exports ──
export type { CreateContactInput, UpdateContactInput } from './schemas/crm';
export type { CreateDealInput, UpdateDealInput } from './schemas/crm';
export type { CreateCompanyInput, UpdateCompanyInput } from './schemas/crm';
export type { CreateLeadInput, UpdateLeadInput } from './schemas/crm';
export type { CreateTaskInput, UpdateTaskInput } from './schemas/entities';
export type { CreateTicketInput, UpdateTicketInput } from './schemas/entities';
export type { CreateInvoiceInput, UpdateInvoiceInput } from './schemas/financial';
export type { CreateQuoteInput } from './schemas/financial';
export type { CreateOrderInput } from './schemas/financial';
export type { CreateContractInput } from './schemas/financial';
export type { CreateSubscriptionInput } from './schemas/financial';
export type { CreateMeetingInput } from './schemas/entities';
export type { CreateNoteInput } from './schemas/entities';
export type { CreatePipelineInput } from './schemas/entities';
export type { CreateDealStageInput } from './schemas/entities';
export type { CreateAutomationInput } from './schemas/admin';
export type { CreateWorkflowInput } from './schemas/admin';
export type { CreateSequenceInput } from './schemas/admin';
export type { CreateWebhookInput } from './schemas/admin';
export type { CreateApiKeyInput } from './schemas/admin';
export type { CreateFormInput } from './schemas/admin';
export type { CreateEmailTemplateInput } from './schemas/admin';
export type { CreateRoleInput } from './schemas/admin';
export type { InviteMemberInput } from './schemas/admin';
export type { BulkDeleteInput } from './schemas/admin';
export type { BulkUpdateInput } from './schemas/admin';
export type { ExportInput } from './schemas/admin';
export type { ImportInput } from './schemas/admin';
export type { SearchInput } from './schemas/admin';
export type { CreateKbArticleInput } from './schemas/admin';
export type { CreateKbCategoryInput } from './schemas/admin';
export type { CreateIntegrationInput } from './schemas/admin';
export type { CreateServiceInput } from './schemas/admin';
export type { CreateProductInput } from './schemas/admin';
export type { ChangePasswordInput } from './schemas/admin';
export type { UpdateProfileInput } from './schemas/admin';
export type { UpdateTenantSettingsInput } from './schemas/admin';
export type { CreateScheduledReportInput } from './schemas/admin';
export type { CreateFollowUpInput, UpdateFollowUpInput } from './schemas/admin';
export type { CreateBackupInput, BackupConfigInput } from './schemas/admin';
export type { CreateCustomFieldInput, UpdateCustomFieldInput } from './schemas/admin';
export type { MergeContactInput } from './schemas/admin';
export type { ConvertLeadInput } from './schemas/admin';
export type { TriggerWorkflowInput } from './schemas/admin';
export type { SendWhatsAppInput } from './schemas/admin';
export type { TestEmailInput } from './schemas/admin';
export type { PublicLeadCaptureInput } from './schemas/admin';
export type { PublicFormSubmitInput } from './schemas/admin';
export type { IpWhitelistInput } from './schemas/admin';
export type { EmailWarmupConfigInput } from './schemas/admin';
export type { OnboardingStepInput } from './schemas/admin';
export type { AiAssistantInput } from './schemas/admin';
export type { AssignContactInput } from './schemas/admin';
export type { UpdateMemberInput } from './schemas/admin';
export type { UpdateTelegramInput } from './schemas/admin';
export type { CheckoutSessionInput } from './schemas/admin';
export type { CreatePlanInput, UpdatePlanInput } from './schemas/admin';
export type { CreateTenantInput, UpdateTenantInput } from './schemas/admin';
export type { CreateProjectInput, UpdateProjectInput } from './schemas/entities';
export type { CreateMilestoneInput } from './schemas/entities';
export type { LinkTaskInput } from './schemas/entities';
