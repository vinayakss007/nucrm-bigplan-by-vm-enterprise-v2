// #3281 negative-control fixture. Do not "fix" these literals: they exist so that
// `npm run guard:seed-credential` has something to turn red on. The screen is only
// evidence when a planted credential fails it — see .github/workflows/ci.yml's
// `seed-credential` job and docs/README.md's rule that a green run proves nothing
// without its second half.
import bcrypt from 'bcryptjs';

const DEFAULT_ADMIN_PASSWORD = 'Hunter2Gate!';

export async function make() {
  return bcrypt.hash('Admin123!', 12);
}

export const read = () => process.env.MY_PASSWORD || 'FallBack1!';
