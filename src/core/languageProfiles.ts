import { TranslatedFileRef } from './buildTranslationPlan';

export type LanguageProfile = {
    id: 'cpp20' | 'rust' | 'go' | 'python';
    label: string;
    sourceExtension: string;
    usesHeaderSourceSeparation: boolean;
    headerExtension?: string;
    renderDependencyReference: (targetPath: string) => string;
    targetIdioms: string;
    systemInstructions: string;
    sanitize: (code: string, role: string, fileName: string) => string;
    ensureIncludes: (code: string, includes: string[], isHeader: boolean) => string; 
    conceptMappings: string[],
};

export const LANGUAGE_PROFILES: Record<string, LanguageProfile> = {
    cpp20: {
        id: 'cpp20',
        label: 'C++20',
        sourceExtension: 'cpp',
        usesHeaderSourceSeparation: true,
        headerExtension: 'h',
        renderDependencyReference: (targetPath: string) => `#include "${targetPath}"`,
        targetIdioms: `
- Map high-level numeric types (e.g., 'decimal') to 'double'.
- Map string types to 'std::string'.
- Map list/array types to 'std::vector<T>'.
- Translate property accesses (e.g., 'obj.Prop') to getter methods (e.g., 'obj.getProp()').
- Remove language-specific numeric suffixes (e.g., '1500.00m' -> '1500.00').
- Use stack allocation or smart pointers instead of GC-managed 'new' where possible.`,
        systemInstructions: `
You are writing idiomatic C++.
- ALWAYS include standard headers (e.g., <iostream>, <string>, <vector>).
- NEVER use 'decimal' or 'string' keywords directly; use 'double' and 'std::string'.
- If you use a class from another file, you MUST include its header.
- If you access a member or property of a class from a dependency, you MUST use its getter methods (e.g., 'obj.getPrezzo()', NOT 'obj.Prezzo').`,
        sanitize: (code: string, role: string, fileName: string) => {
            let clean = code.replace(/\bdecimal\b/g, 'double');
            clean = clean.replace(/(\d+\.\d+)m\b/g, '$1');

            clean = clean.replace(/\b(public|private|protected|internal)\s+(class|struct)\b/g, '$2');

            if (role === 'header') {
                clean = clean.replace(/^\s*[A-Za-z0-9_\-\\/]+\.h\s*\n+/, '');

                clean = clean.replace(/^[^#a-zA-Z]+/, ''); 

                clean = clean.replace(/(namespace\s+\w+\s*\{)\s*(public|private|protected)\s*:\s*/g, '$1\n');

                clean = clean.replace(/\b\w+::\w+\s*\([^)]*\)\s*(?:const)?\s*\{[\s\S]*?\}/g, '');

                clean = clean.replace(/class\s+\w+;\s*/g, '');
            }

            if (role === 'source' || role === 'module') {
                clean = clean.replace(/class\s+[A-Za-z0-9_]+\s*\{[\s\S]*?\n?\};/g, '');

                if (fileName.includes('Program') || fileName.includes('Main')) {
                    clean = clean.replace(/\b(void|static\s+void|int)\s+\w*\s*\([^)]*\)\s*\{/g, 'int main() {');
                }

                if (fileName.includes('Program') || fileName.includes('Main')) {
                    const namespaceMainRegex = /namespace\s+\w+\s*\{[\s\S]*?(?:void|int)\s+Main\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\}/;
                    if (namespaceMainRegex.test(clean)) {
                        clean = clean.replace(namespaceMainRegex, 'int main() {$1}');
                    } else {
                        clean = clean.replace(/(?:void|int)\s+Main\s*\([^)]*\)\s*\{/, 'int main() {');
                    }

                    clean = clean.replace(/namespace\s+\w+\s*\{([\s\S]*?int\s+main\s*\([\s\S]*?\}\s*)\}/, '$1');
                }

                const baseClass = fileName.split(/[/\\]/).pop()?.split('.')[0];
                if (baseClass) {
                    const implRegex = /([A-Za-z_]\w*)::(\w+)\s*\([^)]*\)\s*(?:const)?\s*\{[\s\S]*?\}/g;
                    clean = clean.replace(implRegex, (match, className) => {
                        if (className !== baseClass) {
                            return ''; 
                        }
                        return match;
                    });
                }
            }
            return clean.trim();
        },
        ensureIncludes: (code: string, includes: string[], isHeader: boolean) => {
            let newCode = code;

            if (/(std::)?(cout|cin|endl|cerr)/.test(newCode) && !newCode.includes('#include <iostream>')) {
                newCode = `#include <iostream>\n${newCode}`;
            }
            if (/(std::)?(string)/.test(newCode) && !newCode.includes('#include <string>')) {
                newCode = `#include <string>\n${newCode}`;
            }

            const missingIncludes = includes.filter(inc => !newCode.includes(inc));
            if (missingIncludes.length > 0) {
                const includeStr = missingIncludes.join('\n');
                if (isHeader) {
                    if (!newCode.includes('#pragma once')) newCode = `#pragma once\n${includeStr}\n\n${newCode}`;
                    else newCode = newCode.replace(/#pragma once\s*\n/, `#pragma once\n${includeStr}\n`);
                } else {
                    newCode = `${includeStr}\n\n${newCode}`;
                }
            }
            return newCode;
        },
        conceptMappings: [
            "ACCESS MODIFIERS: Preserve the EXACT access modifiers from the source code. If the source says 'public', use 'public:'. If it says 'private', use 'private:'.",
            "C++ DEFAULTS: In a C++ class, the default access is private. Therefore, you MUST explicitly write 'public:' before methods that were public in the source code, otherwise they will become private by default and break the project.",
            "Properties (e.g., getters/setters): DO NOT use public fields. Create 'private' member variables and explicit getter/setter methods.",
            "String Interpolation: Convert string interpolation (e.g., 'Hello {name}') to C++ standard streams (std::cout) or string concatenation.",
        ],
    },
    rust: {
        id: 'rust',
        label: 'Rust',
        sourceExtension: 'rs',
        usesHeaderSourceSeparation: false,
        renderDependencyReference: (targetPath) => `use crate::${targetPath.replace(/\//g, '::').replace('.rs', '')};`,
        targetIdioms: `- Map high-level numeric types to 'f64' or 'i32'. - Map string types to 'String' or '&str'. - Map lists to 'Vec<T>'.`,
        systemInstructions: `You are writing idiomatic Rust. Use ownership and borrowing correctly.`,
        sanitize: (code: string) => code.replace(/\bdecimal\b/g, 'f64'),
        ensureIncludes: (code, includes) => {
            let newCode = code;
            for (const inc of includes) {
                if (!newCode.includes(inc)) {
                    newCode = `${inc}\n${newCode}`;
                }
            }
            return newCode;
        },
        conceptMappings: [
            "Properties: Use private fields and implement 'impl' blocks with getter methods.",
            "String Interpolation: Use the 'format!()' macro.",
        ],
    },
    go: {
        id: 'go',
        label: 'Go',
        sourceExtension: 'go',
        usesHeaderSourceSeparation: false,
        renderDependencyReference: (targetPath) => `import ".../${targetPath}"`,
        targetIdioms: `- Map numeric types to 'float64'. - Map strings to 'string'. - Map lists to '[]T'.`,
        systemInstructions: `You are writing idiomatic Go. Handle errors explicitly.`,
        sanitize: (code: string) => code.replace(/\bdecimal\b/g, 'float64'),
        ensureIncludes: (code) => code,
        conceptMappings: [],
    },
    python: {
        id: 'python',
        label: 'Python',
        sourceExtension: 'py',
        usesHeaderSourceSeparation: false,
        renderDependencyReference: (targetPath) => `import ${targetPath.replace('.py', '')}`,
        targetIdioms: `- Use Python built-in types (float, str, list, dict).`,
        systemInstructions: `You are writing modern Python 3.12. Use type hints where appropriate.`,
        sanitize: (code: string) => code.replace(/\bdecimal\b/g, 'float'),
        ensureIncludes: (code) => code,
        conceptMappings: [],
    },
};