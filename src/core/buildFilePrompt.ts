// src/core/buildFilePrompt.ts
import { LanguageProfile } from './languageProfiles';
import { PlannedUnit } from './buildTranslationPlan';

function getSourceLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = { 
        cs: 'C#', py: 'Python', rs: 'Rust', go: 'Go', vb: 'Visual Basic', 
        js: 'JavaScript', ts: 'TypeScript', cpp: 'C++', c: 'C', java: 'Java' 
    };
    return map[ext || ''] || ext?.toUpperCase() || 'Unknown';
}

function detectSourceConcepts(source: string): string[] {
    const concepts: string[] = [];
    if (/\{\s*get;|get\s*\{|set\s*\{/.test(source)) {
        concepts.push("The source code uses PROPERTIES. You MUST translate them into explicit getter/setter methods and private fields.");
    }
    if (source.includes('$"') || source.includes('${')) {
        concepts.push("The source code uses STRING INTERPOLATION. You MUST translate it into the target language's string formatting syntax.");
    }
    return concepts;
}

export function buildFilePrompt(
    unit: PlannedUnit,
    sourceContent: string,
    profile: LanguageProfile,
    dependencySignatures: { symbol: string; targetPath: string; signature: string }[],
    targetFileOverride?: { targetPath: string; role: string },
    previousPassCode?: string,
    allDependencyHeaders?: string
): string {
    const activeFiles = targetFileOverride ? [targetFileOverride] : unit.targetFiles;

    const assignedFilesStr = activeFiles
        .map((f) => `- ${f.role.toUpperCase()}: ${f.targetPath}`)
        .join('\n');

    const depsStr = dependencySignatures.length > 0
        ? dependencySignatures.map((d) => `- ${d.symbol} -> ${d.targetPath}`).join('\n')
        : 'None';

    const outputEnvelopes = activeFiles.map((f) => {
        const fenceLang = f.role === 'header' ? 'cpp' : profile.sourceExtension;
        return `===FILE: ${f.targetPath}===\n\`\`\`${fenceLang}\n// code here\n\`\`\``;
    }).join('\n\n');

    const sourceLang = getSourceLanguage(unit.sourceRelativePath);
    
    let strictRules = '';
    if (targetFileOverride?.role === 'header') {
        strictRules = `
- YOU ARE WRITING A HEADER (.h) FILE.
- ONLY PROVIDE DECLARATIONS. NO METHOD BODIES.
- If you use a class from another file, assume it is declared. Add a forward declaration (e.g., 'class Prodotto;').`;
    } else if (targetFileOverride?.role === 'source' || targetFileOverride?.role === 'module') {
        strictRules = `
- YOU ARE WRITING A SOURCE (.cpp) FILE.
- ONLY PROVIDE IMPLEMENTATIONS (e.g., 'double ClassName::Method() { ... }').
- DO NOT REDEFINE THE CLASS.
- DO NOT WRITE A 'main()' FUNCTION UNLESS THIS IS Program.cpp.
- You MUST use 'public:' before methods that are public in the source code.
- You MUST use 'private:' for member variables.
- 🛑 CRITICAL: You MUST ONLY implement methods for the class in THIS file (e.g., ${unit.targetFiles.find(f => f.role === 'source')?.targetStem}). DO NOT write implementations for ANY OTHER class.`;
    }

    const conceptRules = profile.conceptMappings.map(c => `- ${c}`).join('\n');

    const detectedConcepts = detectSourceConcepts(sourceContent);
    const conceptWarnings = detectedConcepts.length > 0 
        ? `\n## DETECTED SOURCE CONCEPTS (CRITICAL)\n${detectedConcepts.map(c => `- ${c}`).join('\n')}\n` 
        : '';

    return `You are a deterministic single-file translation engine.

## TRANSLATION CONTEXT
Source Language: ${sourceLang}
Target Language: ${profile.label}

## ASSIGNED TARGET FILE
You are ONLY responsible for generating this file:
${assignedFilesStr}

${conceptWarnings}
## CURRENT SOURCE (${sourceLang})
Path: ${unit.sourceRelativePath}
\`\`\`${sourceLang.toLowerCase()}
${sourceContent}
\`\`\`

${previousPassCode ? `## PREVIOUSLY GENERATED HEADER (DO NOT RE-DEFINE)\nHere is the header file you already generated. Implement its methods in the .cpp file.\n\`\`\`cpp\n${previousPassCode}\n\`\`\`\n` : ''}

${allDependencyHeaders ? `## EXISTING PROJECT HEADERS (DO NOT HALLUCINATE)\nHere are the exact headers of the classes you depend on. USE THESE CLASSES. DO NOT REDEFINE THEM in your file.\n\`\`\`cpp\n${allDependencyHeaders}\n\`\`\`\n` : ''}

## TARGET LANGUAGE RULES (STRICTLY ENFORCE)
You must adapt the source code to these target-specific rules:
${conceptRules}

${profile.targetIdioms}
${profile.systemInstructions}

## CRITICAL RULES
1. Emit ONLY the envelope format below.
${strictRules}
2. DO NOT STOP GENERATING. You must output the exact envelope format.
3. Output clean code. No prose.

## OUTPUT FORMAT
${outputEnvelopes}

Generate the code now.`;
}