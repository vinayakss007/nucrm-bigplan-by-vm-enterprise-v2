// fixture (#3280): deliberately the blind read, and it says so — a probe of the blindness
// itself has to be allowed to stay unarmed. app-role-counts: allow — measures the RLS gap
export const SQL = 'SELECT count(*)::int AS n FROM users';
