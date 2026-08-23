/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * English translations for NuCRM
 * This is the default/fallback locale.
 */
export const en = {
  nav: {
    dashboard: 'Dashboard',
    contacts: 'Contacts',
    deals: 'Deals',
    leads: 'Leads',
    companies: 'Companies',
    tasks: 'Tasks',
    reports: 'Reports',
    settings: 'Settings',
    calendar: 'Calendar',
    email: 'Email',
    documents: 'Documents',
    invoices: 'Invoices',
  },
  actions: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    search: 'Search',
    filter: 'Filter',
    export: 'Export',
    import: 'Import',
    submit: 'Submit',
    confirm: 'Confirm',
    close: 'Close',
    refresh: 'Refresh',
    download: 'Download',
    upload: 'Upload',
  },
  entities: {
    contact: 'Contact',
    deal: 'Deal',
    lead: 'Lead',
    company: 'Company',
    task: 'Task',
    pipeline: 'Pipeline',
    stage: 'Stage',
    invoice: 'Invoice',
    quote: 'Quote',
    product: 'Product',
    note: 'Note',
    activity: 'Activity',
  },
  billing: {
    plan: 'Plan',
    subscribe: 'Subscribe',
    upgrade: 'Upgrade',
    invoice: 'Invoice',
    payment: 'Payment',
    amount: 'Amount',
    due: 'Due',
    paid: 'Paid',
    trial: 'Trial',
    expires: 'Expires',
  },
  auth: {
    login: 'Login',
    logout: 'Logout',
    signup: 'Sign Up',
    password: 'Password',
    email: 'Email',
    forgotPassword: 'Forgot Password',
    resetPassword: 'Reset Password',
    rememberMe: 'Remember Me',
  },
  status: {
    active: 'Active',
    inactive: 'Inactive',
    won: 'Won',
    lost: 'Lost',
    open: 'Open',
    closed: 'Closed',
    pending: 'Pending',
    draft: 'Draft',
    archived: 'Archived',
    overdue: 'Overdue',
  },
  common: {
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    confirm: 'Are you sure?',
    noResults: 'No results found',
    welcome: 'Welcome, {{name}}',
    itemCount: '{{count}} items',
    lastUpdated: 'Last updated: {{date}}',
    createdBy: 'Created by {{user}}',
    page: 'Page {{current}} of {{total}}',
  },
} as const;

export type TranslationKeys = typeof en;
