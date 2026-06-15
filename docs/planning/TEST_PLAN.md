# NuCRM Comprehensive Test Plan

## Phase 1: Auth Flow (Signup → Login → Setup)

### 1.1 Signup Page (`/auth/signup`)
- [x] Page loads with branding panel and form
- [x] Form fields: workspace name, full name, email, password
- [x] Password strength indicator works
- [x] Terms checkbox required before submit
- [x] Error banner displayed on API failure
- [x] **Success: toast notification appears before redirect**
- [x] Redirects to `/auth/login?signup=1` after 1.5s delay
- [x] Handles duplicate email with 409 error
- [x] Handles rate limiting (5 per minute)

### 1.2 Login Page (`/auth/login`)
- [x] Page loads with branding panel and form
- [x] Email + password fields with validation
- [x] Forgot password link navigates correctly
- [x] **Success: toast notification "Welcome back!" appears**
- [x] Redirects to `/tenant/dashboard` after 800ms delay
- [x] Invalid credentials show error banner
- [x] Rate limiting (10 per 15 min window)
- [x] Brute force blocking after too many attempts

### 1.3 Setup Page (`/setup`)
- [x] Only accessible when no super admin exists
- [x] Validates setup key in production
- [x] Password rules enforced (12+ chars, uppercase, number, special)
- [x] Passwords must match
- [x] **Toast errors shown for validation failures**
- [x] Success redirects to `/tenant/dashboard` after 2s
- [x] Prevents duplicate super admin creation

## Phase 2: Notification System

### 2.1 Toast Notifications (react-hot-toast)
- [x] **Toaster renders in root layout (bottom-right position)**
- [x] **Signup: "Workspace created! Welcome to NuCRM." shows before redirect**
- [x] **Login: "Welcome back!" shows before redirect**
- [x] Error toasts on form validation failures
- [x] Consistent styling: rounded, shadow, card colors
- [x] Auto-dismiss after 4s default duration
- [x] Dismissible via close button (custom notify component)

### 2.2 Notification Bell (Tenant Header)
- [x] Bell icon displays unread count badge
- [x] Click opens notification dropdown panel
- [x] Dropdown shows recent notifications (max 5)
- [x] "Mark all read" button works
- [x] Clicking notification marks as read + navigates
- [x] "View all notifications" links to full page
- [x] Empty state: "All caught up!" message
- [x] Outside click closes panel

### 2.3 Real-time Notifications (SSE)
- [x] `/api/tenant/notifications/stream` endpoint works
- [x] Initial unread count sent on connect
- [x] Polls every 30s for updates
- [x] Keep-alive every 10s
- [x] Exponential backoff reconnect on error

### 2.4 Notification API
- [x] `GET /api/tenant/notifications` - list with pagination
- [x] `PATCH /api/tenant/notifications` - mark read (single + bulk)
- [x] `DELETE /api/tenant/notifications` - soft delete
- [x] `GET /api/tenant/notifications/unread` - unread count
- [x] Auth required for all notification endpoints

### 2.5 Database-backed Notifications
- [x] `createNotification()` creates persisted notification
- [x] `notifyTenantMembers()` broadcasts to active members
- [x] `processMentions()` parses @mentions and notifies users
- [x] Auto-links derived from entity_type + entity_id
- [x] Metadata stored as JSONB

## Phase 3: Cross-cutting Concerns

### 3.1 Auth Middleware
- [x] Protected routes redirect to login when unauthenticated
- [x] Session cookie validation
- [x] CSRF token handling
- [x] Tenant context resolution

### 3.2 Rate Limiting
- [x] Login: 10 req/min
- [x] Signup: 5 req/min
- [x] Brute force: IP + email blocking

### 3.3 Error Handling
- [x] Error boundaries on all route groups
- [x] API errors return structured JSON
- [x] Input validation with zod

## Test Execution Status

| Suite | Tests | Status |
|-------|-------|--------|
| Unit tests | 430 | ✅ PASS |
| Unit tests (notify) | 4 | ⏳ NEW |
| E2E Auth | 4 | ✅ EXISTING |
| E2E Notifications | 6 | ⏳ NEW |
| E2E Smoke | 2 | ✅ EXISTING |
