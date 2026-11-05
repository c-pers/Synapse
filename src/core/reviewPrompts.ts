export function buildReviewPrompt(targetLanguage: string, files: { relative_path: string, content: string }[]): string {
    const filesStr = files.map(f => `===FILE: ${f.relative_path}===\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');

    return `You are a strict QA Compiler auditing a translated ${targetLanguage} project.
Review the following generated code.

YOU MUST PERFORM THESE EXACT CHECKS:
1. Are there any empty .cpp files? If yes, this is an error.
2. Do the .h files contain method bodies (curly braces {})? If yes, this is an error.
3. Do the .cpp files contain redefined classes? If yes, this is an error.
4. **Do the .cpp files contain implementations (ClassName::) for a DIFFERENT class? If yes, this is a critical error.**
5. **Look at Program.cpp. It should only contain main() and method calls. If it contains class implementations, this is an error.**

Return ONLY a JSON object in this exact format. No markdown, no prose.
If there are NO errors, return exactly: {"hasErrors": false, "errors": []}

Example of a GOOD response:
{
  "hasErrors": false,
  "errors": []
}

Example of a BAD response (if there are errors):
{
  "hasErrors": true,
  "errors": [
    { "file": "Prodotto.cpp", "issue": "The method getNome() is missing a return statement." }
  ]
}

## CODEBASE TO REVIEW:
${filesStr}
`;
}

export function buildFixPrompt(targetLanguage: string, files: { relative_path: string, content: string }[], errors: any[]): string {
    const filesStr = files.map(f => `===FILE: ${f.relative_path}===\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
    const errorsStr = errors.map(e => `- File: ${e.file}\n  Issue: ${e.issue}`).join('\n');

    return `You are an expert ${targetLanguage} developer. You previously generated a project, but it failed the QA review.
Here are the files:
${filesStr}

Here are the errors reported:
${errorsStr}

Fix the errors. Output the corrected files using the EXACT envelope format.
You only need to output the files that contain errors. Do NOT output the whole project if only 1 file is broken.

===FILE: relative/path.ext===
\`\`\`
// corrected code
\`\`\`
`;
}