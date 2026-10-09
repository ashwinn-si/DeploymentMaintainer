// Fails (exit 1) when the Mongoose models on disk differ from the latest committed mongoose-drift snapshot,
// i.e. someone changed a schema without taking a snapshot and writing a migration.
// Run from the package folder: node scripts/drift-check.js [project]   (project defaults to "server")
import { diffSnapshots, listSnapshots, loadSnapshot } from 'mongoose-drift';
import { generateTextReport } from 'mongoose-drift/dist/reporter.js';

const project = process.argv[2] ?? 'server';

// Numeric semver-ish order (the library sorts as strings, which puts 1.10.0 before 1.2.0).
function versionCompare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function nextVersion(version) {
  const parts = version.split('.').map(Number);
  parts[1] = (parts[1] ?? 0) + 1;
  parts[2] = 0;
  return parts.join('.');
}

const versions = listSnapshots(project).sort(versionCompare);
if (versions.length === 0) {
  console.error(`No mongoose-drift snapshots found for "${project}" (.mongoose-drift/${project}). Take one with: npm run drift:snapshot -w ${project} -- 1.0.0`);
  process.exit(1);
}
const latest = versions[versions.length - 1];
const next = nextVersion(latest);

const before = await loadSnapshot(latest, project);
const after = await loadSnapshot('HEAD', project);
const diff = diffSnapshots(before, after);

if (Object.keys(diff.collections).length === 0) {
  console.log(`models match snapshot ${latest} (${project}): no drift`);
  process.exit(0);
}

console.error(`models changed since snapshot ${latest}:\n`);
console.error(generateTextReport(diff, latest, 'models on disk'));
console.error(
  `\nRun \`npm run drift:snapshot -w ${project} -- ${next}\`, generate the stub with ` +
    `\`npx mongoose-drift diff ${latest} ${next} -p ${project} --stub\`, ` +
    `write a migration in ${project}/migrations/ and commit both.`,
);
process.exit(1);
