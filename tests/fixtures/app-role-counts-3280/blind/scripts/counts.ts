// fixture (#3280): the count a script reports, with nothing to make it mean anything.
export const SQL = 'SELECT count(*)::int AS n FROM users WHERE is_super_admin';
