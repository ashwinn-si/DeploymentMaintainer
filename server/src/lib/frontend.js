// Knowledge about frontend toolchains: what a repo is (for auto-detection) and how to build it under a
// URL path prefix (apps are served at /<name>/, so asset URLs must be relative to that base).

const DEFAULT_BUILD_COMMAND = 'npm run build';

// Checked in order: astro and the CLIs bundle vite/webpack internally, so they must win over "vite".
const FRAMEWORKS = [
  { id: 'astro', label: 'Astro', dep: 'astro', outputDir: 'dist', baseFlag: '--base' },
  { id: 'react-scripts', label: 'Create React App', dep: 'react-scripts', outputDir: 'build', baseEnv: 'PUBLIC_URL' },
  { id: 'vue-cli', label: 'Vue CLI', dep: '@vue/cli-service', outputDir: 'dist', manualBase: 'set publicPath in vue.config.js' },
  { id: 'angular', label: 'Angular', dep: '@angular/cli', outputDir: 'auto', manualBase: 'build with --base-href' },
  { id: 'vite', label: 'Vite', dep: 'vite', outputDir: 'dist', baseFlag: '--base' },
];

// Frameworks that render on the server at request time: they need a running process.
const SSR_DEPS = [
  { dep: 'next', label: 'Next.js' },
  { dep: 'nuxt', label: 'Nuxt' },
  { dep: '@sveltejs/kit', label: 'SvelteKit' },
  { dep: '@remix-run/node', label: 'Remix' },
  { dep: '@remix-run/serve', label: 'Remix' },
];

const SERVER_DEPS = ['express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi', 'restify', 'hono', 'apollo-server', '@apollo/server'];

function allDeps(pkg) {
  return { ...(pkg?.devDependencies ?? {}), ...(pkg?.dependencies ?? {}) };
}

export function detectFramework(pkg) {
  const deps = allDeps(pkg);
  return FRAMEWORKS.find((f) => f.dep in deps) ?? null;
}

function frameworkSummary(fw) {
  return fw ? { id: fw.id, label: fw.label } : null;
}

// Decides how an unknown repo should be deployed. Pure: callers fetch package.json / index.html.
export function classifyProject({ pkg = null, hasIndexHtml = false } = {}) {
  if (!pkg) {
    return hasIndexHtml
      ? { type: 'static-html', framework: null, outputDir: '.', buildCommand: null, baseSupport: null, reasons: ['index.html and no package.json'] }
      : { type: 'unknown', framework: null, outputDir: null, buildCommand: null, baseSupport: null, reasons: ['no package.json or index.html at the repository root'] };
  }

  const deps = allDeps(pkg);
  const scripts = pkg.scripts ?? {};
  const fw = detectFramework(pkg);
  const ssr = SSR_DEPS.find((s) => s.dep in deps);
  const server = SERVER_DEPS.find((d) => d in deps);

  if (ssr) {
    return {
      type: 'node-server',
      framework: { id: ssr.dep, label: ssr.label },
      outputDir: null,
      buildCommand: scripts.build ? DEFAULT_BUILD_COMMAND : null,
      baseSupport: null,
      reasons: [`${ssr.label} renders on the server, so it needs a running process`],
    };
  }

  if (server && (!fw || scripts.start)) {
    const reasons = [`${server} is a server framework`];
    if (fw) reasons.push(`it also has a ${fw.label} build; pick "Frontend app" if the server only serves the built files`);
    return { type: 'node-server', framework: frameworkSummary(fw), outputDir: null, buildCommand: null, baseSupport: null, reasons };
  }

  if (fw) {
    return {
      type: 'frontend',
      framework: frameworkSummary(fw),
      outputDir: fw.outputDir,
      buildCommand: DEFAULT_BUILD_COMMAND,
      baseSupport: fw.manualBase ? 'manual' : 'auto',
      reasons: [`${fw.label} builds to static files`],
      ...(fw.manualBase ? { baseHint: fw.manualBase } : {}),
    };
  }

  if (scripts.build && !scripts.start) {
    return {
      type: 'frontend',
      framework: null,
      outputDir: 'auto',
      buildCommand: DEFAULT_BUILD_COMMAND,
      baseSupport: 'manual',
      reasons: ['has a build script and no start script'],
      baseHint: 'make sure the build uses /<name>/ as its base path',
    };
  }

  if (scripts.start || pkg.main) {
    return { type: 'node-server', framework: null, outputDir: null, buildCommand: null, baseSupport: null, reasons: ['has a start script'] };
  }

  if (hasIndexHtml) {
    return { type: 'static-html', framework: null, outputDir: '.', buildCommand: null, baseSupport: null, reasons: ['index.html and no build or start script'] };
  }

  return { type: 'unknown', framework: null, outputDir: null, buildCommand: null, baseSupport: null, reasons: ['could not tell what this project is'] };
}

// Apps live at /<name>/, so a build that emits absolute asset URLs ("/assets/x.js") would 404.
// Returns the command and env to build with, plus notes for the deploy log.
export function planStaticBuild({ command, pkg, routePath }) {
  const base = `${routePath.replace(/\/+$/, '')}/`;
  const publicUrl = base.replace(/\/$/, '');
  const env = { BASE_PATH: base, PUBLIC_URL: publicUrl };
  const notes = [];
  let finalCommand = command;

  const fw = detectFramework(pkg);
  const isDefault = command === DEFAULT_BUILD_COMMAND;

  if (!fw) {
    notes.push(`unknown framework: set BASE_PATH (${base}) and PUBLIC_URL (${publicUrl}) are exported; configure your build to use ${base} as its base path`);
  } else if (fw.baseFlag) {
    if (/--base\b/.test(command)) {
      notes.push(`${fw.label}: using the --base already in your command`);
    } else if (isDefault) {
      finalCommand = `${command} -- ${fw.baseFlag}=${base}`;
      notes.push(`${fw.label}: building with ${fw.baseFlag}=${base} so assets load under ${base}`);
    } else {
      notes.push(`${fw.label}: custom build command, so --base was not added; add "${fw.baseFlag}=${base}" to it or assets will 404`);
    }
  } else if (fw.baseEnv) {
    notes.push(`${fw.label}: ${fw.baseEnv}=${publicUrl} is set so assets load under ${base}`);
  } else {
    notes.push(`${fw.label}: cannot set the base path automatically (${fw.manualBase}); use ${base}`);
  }

  return { command: finalCommand, env, notes };
}

export { DEFAULT_BUILD_COMMAND };
