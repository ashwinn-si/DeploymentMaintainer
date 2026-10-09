// Same check as server/scripts/drift-check.js, pointed at the "control" mongoose-drift project.
// Run from control/: node scripts/drift-check.js
process.argv[2] ??= 'control';
await import('../../server/scripts/drift-check.js');
