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
    {
      name: 'identity-may-only-use-kernel',
      severity: 'error',
      from: { path: '^packages/identity/' },
      to: { path: '^(apps|packages/(?!identity/|kernel/))' },
    },
    {
      name: 'agents-must-not-depend-on-downstream-modules',
      severity: 'error',
      from: { path: '^packages/agents/' },
      to: { path: '^(apps|packages/(conversations|execution)/)' },
    },
    {
      name: 'conversations-must-not-depend-on-agents-or-execution',
      severity: 'error',
      from: { path: '^packages/conversations/' },
      to: { path: '^(apps|packages/(agents|execution)/)' },
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
