// Dedicated entry point for process managers (PM2) whose fork mode requires()
// the script into its own wrapper process, which breaks the usual
// `process.argv[1] === fileURLToPath(import.meta.url)` "is this the entry
// module" check in index.js. Calling main() unconditionally here sidesteps
// that: PM2's ecosystem config points at this file, not index.js.
import { main } from './index.js';

main();
