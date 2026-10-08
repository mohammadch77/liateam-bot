// Prints a DASHBOARD_PASSWORD_HASH line for .env.  Usage: npm run hash-password -- 'your password'
// Format scrypt:<salt-hex>:<hash-hex> (no '$', so .env variable expansion cannot mangle it).
import { scryptSync, randomBytes } from 'node:crypto';
const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error('Give a password of at least 10 characters:  npm run hash-password -- "..."');
  process.exit(1);
}
const salt = randomBytes(16);
console.log(`DASHBOARD_PASSWORD_HASH=scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`);
