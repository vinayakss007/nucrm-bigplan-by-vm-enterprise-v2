// fixture (#3280): the same count, inside a transaction that names the context.
export const SQL = `
  BEGIN;
  SELECT set_config('app.is_super_admin', 'true', true);
  SELECT count(*)::int AS n FROM users;
  ROLLBACK;`;
