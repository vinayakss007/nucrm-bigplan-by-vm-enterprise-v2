// fixture (#3280): plans has a USING (true) SELECT policy, so an unarmed session reads
// every row of it and there is no blindness here to screen.
export const SQL = 'SELECT count(*)::int AS n FROM plans';
