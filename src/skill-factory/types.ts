export type SkillLifecycleState =
    | 'drafting'
    | 'synthesizing'
    | 'local-tested'
    | 'pending-review'
    | 'approved'
    | 'active'
    | 'deprecated'
    | 'archived'
    | 'quarantined';

export interface SkillSpec {
    name: string;
    description: string;
    category: string;
    inputs: Record<string, { type: string; description: string; required?: boolean }>;
    outputs: Record<string, { type: string; description: string }>;
    requiredScopes: string[];
    testCases: Array<{
        name: string;
        input: Record<string, unknown>;
        expectedOutput: string;
    }>;
    similarSkills?: string[];
}

export interface ValidationResult {
    passed: boolean;
    warnings: string[];
    errors: string[];
}

export interface SecurityScanResult {
    passed: boolean;
    findings: Array<{
        severity: 'critical' | 'high' | 'medium' | 'low';
        rule: string;
        message: string;
        line?: number;
    }>;
}

export interface SandboxTestResult {
    passed: boolean;
    successRate: number;
    results: Array<{
        testCase: string;
        passed: boolean;
        output?: string;
        error?: string;
        durationMs: number;
    }>;
    avgDurationMs: number;
    mock?: boolean;
}

export interface LLMJudgeResult {
    score: number;
    needsHumanReview: boolean;
    dimensions: {
        utility: number;
        robustness: number;
        security: number;
        documentation: number;
    };
    feedback: string;
}

export interface SkillFactoryJob {
    id: string;
    skillName: string;
    state: SkillLifecycleState;
    spec?: SkillSpec;
    generatedFiles?: {
        skillMd: string;
        indexTs: string;
        testTs: string;
    };
    validationResult?: ValidationResult;
    securityResult?: SecurityScanResult;
    sandboxResult?: SandboxTestResult;
    judgeResult?: LLMJudgeResult;
    installPath?: string;
    reviewId?: string;
    createdBy?: string;
    createdAt: Date;
    updatedAt: Date;
    error?: string;
}
