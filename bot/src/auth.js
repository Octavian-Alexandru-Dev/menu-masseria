// Maps a Telegram chat to a staff identity/role. Reuses the existing
// `staff/{uid}` collection (see docs/data-model.md) rather than a parallel
// allowlist, so a chat is only ever as trusted as the staff account an
// admin has already created by hand — the same trust boundary the rest of
// the app uses (docs/data-model.md, "Trust boundary").
//
// staff/{uid} gains one optional field for this feature: `telegramChatId`
// (string), set by hand in the Firebase console by the admin, the same way
// staff accounts themselves are created (docs/comande-camerieri.md §3).
import { queryEquals } from "./firestoreRest.js";

const VALID_ROLES = new Set(["admin", "waiter", "kitchen"]);

// Returns { uid, name, role } for a recognized+role-assigned staff member,
// or null if this chat isn't linked to any staff account (or is linked but
// has no valid role — same "no-role" case the web UI already handles).
export async function resolveStaffByChatId(env, chatId) {
  const matches = await queryEquals(env, "staff", [["telegramChatId", chatId]], 1);
  const staff = matches[0];
  if (!staff || !VALID_ROLES.has(staff.role)) return null;
  return { uid: staff.id, name: staff.name || "", role: staff.role };
}
