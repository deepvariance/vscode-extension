import { build } from 'esbuild';

// The published package ships only this bundle and the .vsix — no readable source.
// @clack/prompts is bundled in, so the installed package has zero runtime dependencies.
await build({
  entryPoints: ['bin/cli.js'],
  outfile: 'dist/cli.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  minify: true,
  sourcemap: false, // a sourcemap would put the source back on npm
  // No shebang banner: esbuild keeps the one already on bin/cli.js, and a second breaks node.
});

console.log('built dist/cli.js');
