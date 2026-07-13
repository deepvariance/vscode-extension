import { build, context } from 'esbuild';

// VS Code loads extensions with require(), so the ESM sources bundle down to a single CJS file.
const options = {
  entryPoints: ['src/extension.js'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
};

const testOptions = { ...options, entryPoints: ['src/test-entry.js'], outfile: 'dist/test-entry.cjs' };

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  await build(testOptions);
  console.log('built dist/extension.js');
}
