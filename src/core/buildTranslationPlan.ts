import { LanguageProfile } from './languageProfiles';

export type TranslatedFileRef = {
    sourcePath: string;
    targetPath: string;
    targetStem: string;
    role: 'header' | 'source' | 'module';
};

export type PlannedUnit = {
    id: string;
    sourceRelativePath: string;
    targetFiles: TranslatedFileRef[];
    dependencies: string[];
};

function stripSourceExtension(path: string): string {
    return path.replace(/\.[^./\\]+$/, '');
}

function isLikelyEntryPointByPath(rel: string): boolean {
    const base = rel.split(/[/\\]/).pop()?.toLowerCase() ?? '';
    return /^(program|main|app)\.(cs|csx|vb|fs|fsx|java|kt|scala)$/.test(base);
}

function topoSort(ids: string[], deps: Map<string, Set<string>>): string[] {
    const visited = new Set<string>();
    const temp = new Set<string>();
    const order: string[] = [];
    const visit = (id: string) => {
        if (visited.has(id)) return;
        if (temp.has(id)) return;
        temp.add(id);
        (deps.get(id) ?? new Set()).forEach(visit);
        temp.delete(id);
        visited.add(id);
        order.push(id);
    };
    ids.forEach(visit);
    return order;
}

export function buildTranslationPlan(
    nodes: { n: string; path: string }[],
    edges: { from: string; to: string }[],
    profile: LanguageProfile,
    projectRoot: string
): PlannedUnit[] {
    const byId = new Map<string, { n: string; path: string }>();
    nodes.forEach(n => byId.set(n.n, n));

    const deps = new Map<string, Set<string>>();
    edges.forEach(e => {
        if (e.from && e.to && e.from !== e.to) {
            if (!deps.has(e.to)) deps.set(e.to, new Set());
            deps.get(e.to)!.add(e.from);
        }
    });

    return topoSort(nodes.map(n => n.n), deps).map(id => {
        const node = byId.get(id)!;
        const rel = node.path.replace(projectRoot, '').replace(/^[/\\]/, '');
        const stem = stripSourceExtension(rel);
        const isEntry = isLikelyEntryPointByPath(rel);

        const targetFiles: TranslatedFileRef[] = [];

        if (profile.usesHeaderSourceSeparation && profile.headerExtension && !isEntry) {
            targetFiles.push({
                sourcePath: node.path,
                targetPath: `${stem}.${profile.headerExtension}`,
                targetStem: stem,
                role: 'header',
            });
        }

        targetFiles.push({
            sourcePath: node.path,
            targetPath: `${stem}.${profile.sourceExtension}`,
            targetStem: stem,
            role: profile.usesHeaderSourceSeparation && !isEntry ? 'source' : 'module',
        });

        return {
            id,
            sourceRelativePath: rel,
            targetFiles,
            dependencies: [...(deps.get(id) ?? [])],
        };
    });
}