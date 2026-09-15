export type FeatureFlag =
  | 'nextArchitecture'
  | 'toolRuntime'
  | 'contextArtifacts'
  | 'employeeWorkspace'
  | 'filesystemWorkspace';

export interface FeatureFlags {
  isEnabled(flag: FeatureFlag): boolean;
}

export class EnvironmentFeatureFlags implements FeatureFlags {
  constructor(private readonly values: Readonly<Record<FeatureFlag, boolean>>) {}

  isEnabled(flag: FeatureFlag): boolean {
    return this.values[flag];
  }
}

export class InMemoryFeatureFlags implements FeatureFlags {
  constructor(private readonly values: Readonly<Partial<Record<FeatureFlag, boolean>>>) {}

  isEnabled(flag: FeatureFlag): boolean {
    return this.values[flag] ?? false;
  }
}
