import { TranslatedFileRef } from './buildTranslationPlan';
import { LanguageProfile } from './languageProfiles';

export class TranslationRegistry {
    private sigByTargetPath = new Map<string, string>();
    private targetByUnit = new Map<string, TranslatedFileRef[]>();
    private headerCodeByUnit = new Map<string, string>();

    register(unitId: string, targetFiles: TranslatedFileRef[], sigByPath: Map<string, string>, headerCode?: string) {
        this.targetByUnit.set(unitId, targetFiles);
        for (const [p, sig] of sigByPath) this.sigByTargetPath.set(p, sig);
        if (headerCode) this.headerCodeByUnit.set(unitId, headerCode);
    }

    getHeaderCode(unitId: string): string | undefined {
        return this.headerCodeByUnit.get(unitId);
    }

    getRefs(unitId: string): TranslatedFileRef[] | undefined {
        return this.targetByUnit.get(unitId);
    }

    getSignatureForUnit(unitId: string): { targetPath: string; signature: string } | undefined {
        const refs = this.targetByUnit.get(unitId);
        if (!refs?.length) return undefined;
        const preferred = refs.find(r => r.role === 'header') ?? refs[0];
        const sig = this.sigByTargetPath.get(preferred.targetPath);
        return sig ? { targetPath: preferred.targetPath, signature: sig } : undefined;
    }

    getAllSymbols(): string[] {
        const symbols = new Set<string>();
        for (const [path, sig] of this.sigByTargetPath) {
            const match = sig.match(/\b(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)/);
            if (match) symbols.add(match[1]);
        }
        return Array.from(symbols);
    }
}

export function extractSignature(
    content: string,
    ref: TranslatedFileRef,
    profile: LanguageProfile
): string {
    if (ref.role === 'header') {
        return content.split('\n').slice(0, 40).join('\n');
    }
    return extractPublicApi(content, profile);
}

export function extractPublicApi(content: string, profile: LanguageProfile): string {
    const lines = content.split('\n');
    let matched: string[] = [];
    switch (profile.id) {
        case 'cpp20':
            matched = lines.filter(l =>
                /^\s*(class|struct|namespace|enum\s+(class|struct)?|using|typedef|template\s*<)/.test(l)
            );
            break;
        case 'rust':
            matched = lines.filter(l =>
                /^\s*pub\s+(fn|struct|enum|trait|type|const|static|mod|use)\s+/.test(l)
            );
            break;
        case 'go':
            matched = lines.filter(l =>
                /^(type|func|var|const)\s+[A-Z]/.test(l.trim())
            );
            break;
        case 'python':
            matched = lines.filter(l =>
                /^(class\s+[A-Za-z_]|def\s+[a-zA-Z_]|from\s|import\s)/.test(l)
            );
            break;
    }
    return matched.slice(0, 25).join('\n').trim()
        || `// [${profile.label}] no public API detected`;
}

export function extractPrimarySymbol(
    signature: string,
    profile: LanguageProfile
): string | undefined {
    switch (profile.id) {
        case 'cpp20':
            return signature.match(
                /\b(?:class|struct|enum\s+(?:class|struct)?|enum|namespace)\s+([A-Za-z_][A-Za-z0-9_]*)/
            )?.[1];
        case 'rust':
            return signature.match(
                /\bpub\s+(?:struct|enum|trait|type|fn|const|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/
            )?.[1];
        case 'go':
            return signature.match(/\btype\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1]
                ?? signature.match(/\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
        case 'python':
            return signature.match(
                /\b(?:class|def)\s+([A-Za-z_][A-Za-z0-9_]*)/
            )?.[1];
    }
    return undefined;
}