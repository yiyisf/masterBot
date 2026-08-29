export type FeatureFlag = 'nextArchitecture';

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
  constructor(private readonly values: Readonly<Record<FeatureFlag, boolean>>) {}

  isEnabled(flag: FeatureFlag): boolean {
    return this.values[flag];
  }
}
