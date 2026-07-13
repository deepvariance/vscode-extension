import { build, context } from 'esbuild';

// VS Code loads extensions with require(), so the ESM sources bundle down to a single CJS file.
const options = {
  entryPoints: ['src/extension.js'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  minify: process.argv.includes('--minify'),
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching…');
} else {
  await build(options);
  console.log('built dist/extension.js');
}
