import { TranslatedFileRef } from './buildTranslationPlan';

export type ValidationResult = {
    accepted: { relativePath: string; content: string }[];
    missing: TranslatedFileRef[];
    rejected: { relativePath: string; reason: string }[];
};

export function validateAgainstPlan(
    extracted: { relativePath: string; content: string }[],
    assigned: TranslatedFileRef[]
): ValidationResult {
    const byPath = new Map(extracted.map(f => [f.relativePath, f]));
    const assignedPaths = new Set(assigned.map(a => a.targetPath));

    const accepted: ValidationResult['accepted'] = [];
    const missing: TranslatedFileRef[] = [];
    const rejected: ValidationResult['rejected'] = [];

    for (const a of assigned) {
        const f = byPath.get(a.targetPath);
        if (f && f.content.trim().length > 0) accepted.push(f);
        else missing.push(a);
    }
    for (const f of extracted) {
        if (!assignedPaths.has(f.relativePath)) {
            rejected.push({ relativePath: f.relativePath, reason: 'not assigned by plan' });
        }
    }
    return { accepted, missing, rejected };
}