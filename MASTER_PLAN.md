# NuCRM → Industry-Grade Master Plan

## Sprint 1: Quick Wins
- [ ] Sidebar collapse animation (sidebar.tsx)
- [ ] Mobile sidebar slide animation (shell.tsx)
- [ ] confirm() → Toast undo (all delete actions)
- [ ] View toggle full page reload fix (deals/page.tsx)
- [ ] Hover-only actions on mobile (companies, contacts)
- [ ] Google Fonts render blocking fix (globals.css → layout.tsx)
- [ ] Calendar "Loading..." → skeleton (calendar/page.tsx)
- [ ] Merge duplicate analytics pages

## Sprint 2: Database Performance
- [ ] Add 12 missing indexes
- [ ] Dashboard: 9 queries → 2 (dashboard/stats/route.ts)
- [ ] Companies API: Add pagination
- [ ] Tickets API: Add offset
- [ ] Search API: Add offset + trigram indexes
- [ ] Fix Cache-Control: public
- [ ] Move automations to queue
- [ ] Bulk email worker parallel

## Sprint 3: UI Smoothness
- [ ] Page transition animations
- [ ] Stagger skeleton loading
- [ ] Sidebar collapsible sections + search
- [ ] Notification mark all read undo
- [ ] Header search → link to detail
- [ ] Ticket create/detail views
- [ ] Calendar event click → edit + week/day view
- [ ] Pagination page size selector
- [ ] Dark mode system preference
- [ ] prefers-reduced-motion

## Sprint 4: Workflow & Features
- [ ] Bulk select + batch actions
- [ ] Inline editing on data tables
- [ ] Global Quick Create button
- [ ] Undo/redo for all actions
- [ ] Keyboard shortcuts
- [ ] Kanban touch drag support
- [ ] Calendar drag to reschedule

## Sprint 5: Missing Modules
- [ ] Knowledge Base
- [ ] Email Inbound
- [ ] PWA Setup
- [ ] Customer Portal
- [ ] Slack Integration
- [ ] Swagger/OpenAPI docs

## Sprint 6: Code Quality
- [ ] Centralize API client
- [ ] Merge duplicate cache utils
- [ ] React.memo on list components
- [ ] Fix bg-opacity-10
- [ ] Request cancellation
- [ ] Consistent error handling
