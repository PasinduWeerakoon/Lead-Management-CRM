# 05 Auth, roles and sharing

## Sign in

- Google sign-in only. No passwords, no email links
- Allowed: any verified Google account on `1billiontech.com`. There are no guests: everyone signs in with Google and gets a normal user record, so all activity is tied to a person
- If someone outside the domain must use it, the super admin adds their Google email to the allow list. They then become a normal user, same as staff
- Not allowed: everyone else. They see "This account doesn't have access" and nothing else
- Disabled users are signed out on their next request

## Roles

| | Super admin | User |
|---|---|---|
| Own profiles, import, search, fill in data | Yes | Yes |
| Share own profiles | Yes | Yes |
| See other people's profiles | Only when shared, like everyone else | Only when shared |
| Allow list | Yes | No |
| Templates (create, edit, archive) | Yes | Use only |
| AI daily limit | Change | Sees remaining amount only |
| People list, disable users | Yes | No |
| Activity log | Yes | No |
| See that admin areas exist | Yes | No |

The super admin is the user whose email matches `SUPERADMIN_EMAIL`. It cannot be granted from the UI, so there is no "make admin" button.

**Hiding admin details:** for users, the API never returns admin data and the UI never renders Admin or Activity tabs or links. Admin endpoints return 404 (not 403) to users, so they don't reveal that they exist. Sign in and error screens don't name the admin.

## Profiles and sharing

- A profile is a set of contacts plus its searches and runs. Each user can have many
- A profile has one owner. Profiles are never merged
- Owner shares by Google email as Editor or Viewer

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| View contacts, research, searches, results | Yes | Yes | Yes |
| Export | Yes | Yes | Yes |
| Edit status, notes, tags | Yes | Yes | No |
| Import into the profile | Yes | Yes | No |
| Create and run searches | Yes | Yes | No |
| Share, unshare, rename, delete | Yes | No | No |

Company and person research is shared across all profiles because it is public business information. Contact status, notes and tags stay inside their profile.

## Activity log

Written by the API, never by the browser. Entries for: sign in, import, research started, search run (with cost), contact changes (batched: "marked 6 contacts as contacted"), share and unshare, export, every admin change.

Shown only to the super admin, with filters by person, action and date, and CSV export. Entries can't be edited or deleted. Kept 12 months.

## Session handling

- Server session id in an httpOnly, Secure, SameSite=Lax cookie
- 14 days, renewed on use. Sign out deletes the session
- Disabling a user deletes all their sessions
