# QA Test Matrix — Auth Compliance

Legend: PASS | FAIL | MISSING (untested but implementable) | UNTESTABLE (feature not built)

## RBAC Helpers
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-001 | requireAuth() redirects unauthenticated | §7 | src/lib/auth.ts | UNTESTABLE | Function does not exist |
| TC-002 | getCurrentUser() returns null when no session | §7 | src/lib/auth.ts:34-61 | MISSING | Function exists, no test |
| TC-003 | getCurrentUser() returns AppUser with role | §7 | src/lib/auth.ts:44-60 | MISSING | Function exists, no test |
| TC-004 | requireAdmin() redirects non-admin | §7 | — | UNTESTABLE | Function does not exist |
| TC-005 | requireAdmin() redirects unauthenticated | §7 | — | UNTESTABLE | Function does not exist |
| TC-006 | withAuth() returns 401 unauthenticated | §7 | — | UNTESTABLE | Function does not exist |
| TC-007 | withAdminAuth() returns 403 non-admin | §7 | — | UNTESTABLE | Function does not exist |
| TC-008 | central_planner passes canManageEvents() | §7 | src/lib/roles.ts:16-18 | MISSING | Function exists, no test |
| TC-009 | executive fails canManageEvents() | §7 | src/lib/roles.ts:16-18 | MISSING | Function exists, no test |
| TC-010 | Role read from profile table not user_metadata | §7 | src/lib/auth.ts:44-48 | MISSING | Code compliant, no test |
| TC-011 | normalizeRole defaults unknown to venue_manager | §7 | src/lib/auth.ts:4-14 | MISSING | Could be a dangerous default, no test |

## CSRF
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-021 | Missing x-csrf-token returns 403 on POST | §4 | middleware.ts | UNTESTABLE | No CSRF implementation |
| TC-022 | Mismatched CSRF token returns 403 | §4 | middleware.ts | UNTESTABLE | No CSRF implementation |
| TC-023 | Valid CSRF token passes on POST | §4 | middleware.ts | UNTESTABLE | No CSRF implementation |
| TC-024 | GET requests bypass CSRF | §4 | middleware.ts | UNTESTABLE | No CSRF implementation |
| TC-025 | Sign-out without CSRF returns 403 | §4 | src/actions/auth.ts:101-105 | FAIL | Server action, no CSRF check |
| TC-026 | CSRF cookie is httpOnly:false | §4 | — | UNTESTABLE | No CSRF cookie |
| TC-027 | Constant-time comparison used | §4 | — | UNTESTABLE | No CSRF implementation |

## Account Lockout
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-041 | 5th failed attempt triggers lockout | §5 | — | UNTESTABLE | No lockout implementation |
| TC-042 | Locked account rejects correct password | §5 | — | UNTESTABLE | No lockout implementation |
| TC-043 | Successful sign-in clears counter for IP | §5 | — | UNTESTABLE | No lockout implementation |
| TC-044 | Password reset clears all-IP lockout | §5 | — | UNTESTABLE | No lockout implementation |
| TC-045 | Lockout returns same 401 as wrong password | §5 | — | UNTESTABLE | No lockout implementation |
| TC-046 | Lockout per email+IP not email alone | §5 | — | UNTESTABLE | No lockout implementation |

## Password Policy
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-061 | Password < 12 chars rejected | §10 | src/actions/auth.ts:38 | FAIL | `.min(8)` used |
| TC-062 | Password > 128 chars rejected | §10 | src/actions/auth.ts:38 | FAIL | No max set |
| TC-063 | No uppercase rejected | §10 | — | UNTESTABLE | No complexity check |
| TC-064 | No lowercase rejected | §10 | — | UNTESTABLE | No complexity check |
| TC-065 | No number rejected | §10 | — | UNTESTABLE | No complexity check |
| TC-066 | No special char rejected | §10 | — | UNTESTABLE | No complexity check |
| TC-067 | HIBP check called for valid passwords | §10 | — | UNTESTABLE | No HIBP integration |
| TC-068 | HIBP uses SHA-1 k-anonymity not SHA-256 | §10 | — | UNTESTABLE | No HIBP integration |
| TC-069 | Policy enforced server-side | §10 | src/actions/auth.ts | FAIL | Client-side only |
| TC-070 | Single validatePassword() function used everywhere | §10 | — | UNTESTABLE | Function does not exist |

## Session Management
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-081 | Idle session (30min) destroys session | §3 | — | UNTESTABLE | No session store |
| TC-082 | Absolute timeout (24h) destroys session | §3 | — | UNTESTABLE | No session store |
| TC-083 | Renewal updates lastActivityAt only | §3 | — | UNTESTABLE | No session store |
| TC-084 | Session store error fails closed | §3 | — | UNTESTABLE | No session store |
| TC-085 | destroyAllSessionsForUser then new session created | §3 | — | UNTESTABLE | Function does not exist |
| TC-086 | Max 5 concurrent sessions enforced | §3 | — | UNTESTABLE | No session store |

## Invite Flow
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-101 | Half-created user deleted if step 2 fails | §8 | src/actions/users.ts:130-141 | FAIL | No cleanup on upsert failure |
| TC-102 | Resend blocked if already confirmed | §8 | src/actions/users.ts:94-99 | FAIL | No email_confirmed_at check |
| TC-103 | Invite accepted via /auth/confirm | §8 | — | UNTESTABLE | Route doesn't exist |
| TC-104 | Invite expiry 7 days | §8 | src/actions/users.ts:95 | MISSING | Relies on Supabase default |
| TC-105 | Invite role stored in app_metadata | §8 | src/actions/users.ts:123 | FAIL | Stored in users.role DB column |

## Audit Logging
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-121 | auth.login.success logged | §9 | src/actions/auth.ts | UNTESTABLE | Not implemented |
| TC-122 | auth.login.failure logged with hashed email | §9 | src/actions/auth.ts | UNTESTABLE | Not implemented |
| TC-123 | auth.lockout logged | §9 | — | UNTESTABLE | Not implemented |
| TC-124 | auth.logout logged | §9 | src/actions/auth.ts:101-105 | UNTESTABLE | Not implemented |
| TC-125 | auth.password_reset.requested logged | §9 | src/actions/auth.ts:107 | UNTESTABLE | Not implemented |
| TC-126 | auth.password_updated logged | §9 | src/actions/auth.ts:232 | UNTESTABLE | Not implemented |
| TC-127 | auth.invite.sent logged with hashed email | §9 | src/actions/users.ts:95 | UNTESTABLE | Not implemented |
| TC-128 | auth.role.changed logged | §9 | src/actions/users.ts:47 | UNTESTABLE | Not implemented |
| TC-129 | auth.session.expired.idle logged | §9 | — | UNTESTABLE | Not implemented |
| TC-130 | auth.session.expired.absolute logged | §9 | — | UNTESTABLE | Not implemented |
| TC-131 | Emails SHA-256 hashed in logs | §9 | — | UNTESTABLE | Not implemented |

## Role Demotion
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-141 | destroyAllSessionsForUser called on demotion | §8 | src/actions/users.ts:47-51 | FAIL | Not called |
| TC-142 | Demoted user session rejected on next request | §8 | middleware.ts | UNTESTABLE | No session store |

## Security Headers
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-161 | X-Content-Type-Options: nosniff | §2 | middleware.ts | FAIL | Absent |
| TC-162 | X-Frame-Options: DENY | §2 | middleware.ts | FAIL | Absent |
| TC-163 | Strict-Transport-Security | §2 | middleware.ts | FAIL | Absent |
| TC-164 | Content-Security-Policy | §2 | middleware.ts | FAIL | Absent |
| TC-165 | Referrer-Policy | §2 | middleware.ts | FAIL | Absent |
| TC-166 | Permissions-Policy | §2 | middleware.ts | FAIL | Absent |
| TC-167 | X-XSS-Protection: 0 | §2 | middleware.ts | FAIL | Absent |

## Password Reset Flow
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-181 | Generic success regardless of email existence | §8 | src/actions/auth.ts:127-161 | PASS | Both paths redirect to success |
| TC-182 | Reset link expiry 60 minutes | §8 | — | MISSING | Relying on Supabase default |
| TC-183 | destroyAllSessionsForUser called after password update | §8 | src/actions/auth.ts:244 | FAIL | Only signOut() called |
| TC-184 | New session issued after destroyAll | §8 | — | UNTESTABLE | Function doesn't exist |
| TC-185 | Post-reset redirect is same-origin | §8 | src/actions/auth.ts:245 | PASS | Redirects to /login |
| TC-186 | PKCE verifyOtp used for token exchange | §8 | src/actions/auth.ts:204 | FAIL | Uses exchangeCodeForSession, not verifyOtp |
| TC-187 | Tokens not exposed in DOM | §8 | reset-password-card.tsx:136-138 | FAIL | Hidden form fields contain tokens |

## Additional
| ID | Description | Std Ref | Code Path | Result | Evidence |
|----|-------------|---------|-----------|--------|----------|
| TC-201 | Middleware uses getUser() not getSession() | §2 | middleware.ts:41 | FAIL | getSession() called |
| TC-202 | redirectedFrom validated as same-origin | §2 | src/app/login/page.tsx | PASS | sanitizeRedirect function |
| TC-203 | No public sign-up route | §8 | src/app/* | PASS | No /register /signup routes |
| TC-204 | Forgot-password returns success for non-existent email | §8 | src/actions/auth.ts:127-161 | PASS | Generic redirect always |
| TC-205 | Invite restricted to central_planner | §7 | src/actions/users.ts:75-76 | PASS | Role check present |
| TC-206 | updateUser restricted to central_planner | §7 | src/actions/users.ts:27-28 | PASS | Role check present |
| TC-207 | Password reset session left open if updateUser fails | §8 | src/actions/auth.ts:232-243 | FAIL | Session active, error returned, no cleanup |
