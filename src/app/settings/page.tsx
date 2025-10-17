const settingsSections = [
  {
    title: "Profile & authentication",
    description:
      "Supabase-authenticated users manage contact details, notification preferences, and password resets.",
    items: [
      "Profile card sourced from Supabase `users` view.",
      "Notification toggles stored in `user_preferences` (to be defined).",
      "Link to initiate password reset via Supabase Auth UI.",
    ],
  },
  {
    title: "Role awareness",
    description:
      "Surface role, venue assignments, and escalation contacts so users understand their permissions.",
    items: [
      "Display derived role label with tooltip on capabilities.",
      "List assigned venues (for managers) or regions (for reviewers).",
      "Escalation contact info for HQ planners.",
    ],
  },
  {
    title: "Security & audit",
    description:
      "Hook into audit logs to show recent sensitive changes and allow sign-out from other devices.",
    items: [
      "Recent security events (password change, session invalidation).",
      "Device/session list with revoke action.",
      "Inline link to privacy policy and data retention notes.",
    ],
  },
];

export default function SettingsPage() {
  return (
    <section className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
        <p className="max-w-2xl text-base text-black/70">
          Account settings wrap around Supabase Auth and role management. These
          flows launch alongside the initial auth build to keep self-service
          updates simple.
        </p>
        <div className="inline-flex flex-wrap items-center gap-3 text-sm text-black/70">
          <span className="rounded-full bg-black px-3 py-1 font-medium text-white">
            Milestone: EP-104
          </span>
          <span>
            Reference: <code>docs/PRD.md</code>
          </span>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {settingsSections.map((area) => (
          <div
            key={area.title}
            className="flex h-full flex-col rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm"
          >
            <div className="space-y-3">
              <h2 className="text-lg font-medium text-black">{area.title}</h2>
              <p className="text-sm text-black/70">{area.description}</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-black/80">
              {area.items.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span aria-hidden className="mt-1 h-1.5 w-1.5 rounded-full bg-black/40" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
