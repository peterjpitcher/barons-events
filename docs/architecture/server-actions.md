---
generated: true
last_updated: 2026-06-09
source: session-setup
project: baronshub
---

# Server Actions

All mutations run through `'use server'` functions in `src/actions/`. Each re-verifies auth server-side (never relying on UI hiding) and most call `logAuditEvent()` + `revalidatePath()`. See [[data-model]] for tables and [[relationships]] for the auth chain. Routes that invoke these live in [[routes]].

**22 action files** scanned. Columns: tables touched (direct `.from(...)` + `.rpc(...)`), auth check style, audit logging, cache revalidation.

## Auth column legend

- **session** — calls `getCurrentUser()` / `getSupabaseServerClient()` / `getUser()`.
- **role** — gates on `src/lib/roles.ts` capability fn (`canManageX`, `isAdministrator`, etc.). Capability checks resolve the current user internally, so most files show **role** without a separate **session** tag.
- **(none)** — no in-file auth detected; relies on caller/middleware or operates on the authenticated user's own record (verify individually).

## Action inventory

| Action(s) | Source File | Tables / RPCs | Auth | Audit | Revalidate |
|-----------|-------------|---------------|------|-------|-----------|
| `updateCommunicationPreferencesAction` | `src/actions/account.ts` | `users` | (own record) | yes | yes |
| `createArtistAction`, `updateArtistAction`, `archiveArtistAction`, `restoreArtistAction` | `src/actions/artists.ts` | via `src/lib/artists.ts` | role | yes | yes |
| `requestAttachmentUploadAction`, `confirmAttachmentUploadAction`, `renameAttachmentAction`, `requestAttachmentVersionUploadAction`, `confirmAttachmentVersionUploadAction`, `deleteAttachmentAction`, `getAttachmentUrlAction`, `getAttachmentVersionUrlAction` | `src/actions/attachments.ts` | `attachments`, `attachment_versions`, `planning_items`, `planning_tasks` | role | yes | yes |
| `signInAction`, `signOutAction`, `requestPasswordResetAction`, `completePasswordResetAction` | `src/actions/auth.ts` | `users` | session, role | yes | no |
| `createBookingAction`, `updateExistingBookingAction`, `cancelBookingAction`, `refundBookingAction` | `src/actions/bookings.ts` | `event_bookings`, `events`, `customers`, `sms_campaign_sends` | role | yes | yes |
| `updateBusinessSettingsAction` | `src/actions/business-settings.ts` | `business_settings` | role | yes | yes |
| `deleteCustomerAction` | `src/actions/customers.ts` | `customers`, `event_bookings` | role | yes | no |
| `submitDebriefAction` | `src/actions/debriefs.ts` | `debriefs`, `events`, `planning_items`, `planning_tasks`, `sop_task_templates`, `business_settings` | role | yes | yes |
| `createEventTypeAction`, `updateEventTypeAction`, `deleteEventTypeAction` | `src/actions/event-types.ts` | via `src/lib/event-types.ts` | role | yes | yes |
| `saveEventDraftAction`, `submitEventForReviewAction`, `reviewerDecisionAction`, `updateEventStatusAction`, `generateWebsiteCopyAction`, `generateWebsiteCopyFromFormAction`, `generateTermsAndConditionsAction`, `updateAssigneeAction`, `deleteEventAction`, `archiveDraftEventAction`, `revertToDraftAction`, `updateBookingSettingsAction` | `src/actions/events.ts` | `events`, `venues`, `users` · rpc `set_event_venues` | role | yes | yes |
| `addInternalNoteAction` | `src/actions/internal-notes.ts` | `internal_notes`, `planning_items` | role | yes | yes |
| `createShortLinkAction`, `updateShortLinkAction`, `deleteShortLinkAction`, `getOrCreateUtmVariantAction` | `src/actions/links.ts` | via `src/lib/links-server.ts` | role | yes | yes |
| `createServiceTypeAction`, `updateServiceTypeAction`, `deleteServiceTypeAction`, `upsertVenueOpeningHoursAction`, `upsertMultiVenueOpeningHoursAction`, `createOpeningOverrideAction`, `updateOpeningOverrideAction`, `deleteOpeningOverrideAction` | `src/actions/opening-hours.ts` | via `src/lib/opening-hours.ts` | role | yes | yes |
| `createPlanningItemAction`, `updatePlanningItemAction`, `movePlanningItemDateAction`, `deletePlanningItemAction`, `createPlanningSeriesAction`, `updatePlanningSeriesAction`, `pausePlanningSeriesAction`, `createPlanningTaskAction`, `createPlanningTaskDependencyAction`, `deletePlanningTaskDependencyAction`, `updatePlanningTaskAction`, `togglePlanningTaskStatusAction`, `reassignPlanningTaskAction`, `deletePlanningTaskAction`, `convertInspirationItemAction`, `dismissInspirationItemAction`, `refreshInspirationItemsAction` | `src/actions/planning.ts` | `planning_items`, `planning_series`, `planning_tasks`, `planning_task_assignees`, `planning_task_dependencies`, `planning_inspiration_items`, `planning_inspiration_dismissals` · rpc `set_planning_item_venues` | role | yes | yes |
| `proposeEventAction`, `preApproveEventAction`, `preRejectEventAction` | `src/actions/pre-event.ts` | `venues` · rpc `create_multi_venue_event_proposals`, `pre_approve_event_proposal`, `reject_event_proposal` | role | yes | yes |
| `addSltMemberAction`, `removeSltMemberAction` | `src/actions/slt.ts` | `slt_members` | role | yes | yes |
| `loadSopAssignableUsersAction`, `loadSopTemplateAction`, `createSopSectionAction`, `updateSopSectionAction`, `deleteSopSectionAction`, `createSopTaskTemplateAction`, `updateSopTaskTemplateAction`, `deleteSopTaskTemplateAction`, `createSopDependencyAction`, `deleteSopDependencyByCompositeAction`, `deleteSopDependencyAction`, `backfillSopChecklistsAction` | `src/actions/sop.ts` | `sop_sections`, `sop_task_templates`, `sop_task_dependencies`, `events`, `planning_items` | role | yes | yes |
| `setUserPinPreferenceAction` | `src/actions/user-preferences.ts` | `users` | (own record) | yes | yes |
| `updateUserAction`, `inviteUserAction`, `resendInviteAction`, `listReassignmentTargets`, `getUserImpactSummary`, `deactivateUserAction`, `reactivateUserAction`, `deleteUserAction` | `src/actions/users.ts` | `users`, `app_sessions`, `audit_log`, `events`, `event_versions`, `event_artists`, `artists`, `debriefs`, `planning_items`, `planning_series`, `planning_series_task_templates`, `planning_tasks`, `planning_task_assignees`, `approvals`, `short_links`, `venues`, `venue_opening_overrides` · rpc `reassign_and_deactivate_user`, `reassign_user_content` | session, role | yes | yes |
| `createVenueAction`, `updateVenueAction`, `deleteVenueAction` | `src/actions/venues.ts` | `venues`, `pending_cascade_backfill` | role | yes | yes |

## Notes

- **Audit coverage is near-universal** — every action file calls `logAuditEvent()`. There is a dedicated `src/actions/__tests__/audit-coverage.test.ts` guarding this.
- **`account.ts` and `user-preferences.ts`** show no capability check because they mutate the authenticated user's own row; confirm they resolve the user from session, not from request input.
- **`auth.ts`** intentionally skips `revalidatePath` (sign-in/out handle redirects directly).
- **RPC-backed flows** (`events.ts`, `pre-event.ts`, `planning.ts`, `users.ts`) push multi-row transactional work into PostgreSQL functions. The `EVENT_SAVE_USE_RPC` flag toggles the atomic event-save path — see [[overview]].
