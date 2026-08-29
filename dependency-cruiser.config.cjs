/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-workspace-dependencies',
      severity: 'error',
      from: { path: '^(apps|packages)/' },
      to: { circular: true },
    },
    {
      name: 'packages-must-not-depend-on-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'kernel-must-remain-independent',
      severity: 'error',
      from: { path: '^packages/kernel/' },
      to: { path: '^(apps|packages/(?!kernel/))' },
    },
    {
      name: 'contracts-may-only-use-kernel',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: '^(apps|packages/(?!contracts/|kernel/))' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: '(^|/)(dist|\\.next|node_modules)/',
    tsConfig: { fileName: 'tsconfig.next.json' },
    enhancedResolveOptions: {
      conditionNames: ['types', 'development', 'import', 'default'],
      exportsFields: ['exports'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/[^/]+' },
    },
  },
};
