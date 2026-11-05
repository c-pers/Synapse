import { useEffect, useState, ChangeEvent, useCallback } from "react";
import "./App.css";
import { LogViewer } from "./components/LogViewer";
import { Worktable } from "./components/Worktable";
import { logger } from "./logger";
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir } from "@tauri-apps/plugin-fs";
import { FileNode, GraphEdge } from "./components/types";
import { Settings } from "./components/Settings";

import { LANGUAGE_PROFILES } from './core/languageProfiles';
import { buildTranslationPlan } from './core/buildTranslationPlan';
import { TranslationRegistry, extractSignature, extractPrimarySymbol } from './core/translationRegistry';
import { buildFilePrompt } from './core/buildFilePrompt';
import { validateAgainstPlan } from './core/validatePlan';
import { buildReviewPrompt, buildFixPrompt } from './core/reviewPrompts';

type Section = 'dashboard' | 'logs' | 'settings' | 'command_center';

interface ModelOption {
  provider: 'local' | 'cloud';
  label: string;
  value: string;
  disabled?: boolean;
}

function extractEnvelope(aiResponse: string, expectedPath: string, profile: any): string | null {
    const fileRegex = /===FILE:\s*(.+?)===\s*(?:```[a-zA-Z0-9+#-]*\r?\n)?([\s\S]*?)(?:```|(?===FILE:)|$)/g;
    let match;
    while ((match = fileRegex.exec(aiResponse)) !== null) {
        if (match[1].trim() === expectedPath) {
            let content = match[2].replace(/```/g, '').trim();
            content = content.replace(/=\s*$/, '').trim(); 
            if (content.length > 0) return content;
        }
    }
    
    let trimmed = aiResponse.trim();
    const codeBlockMatch = trimmed.match(/```[a-zA-Z0-9+#-]*\r?\n([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    
    const codeStart = trimmed.search(/(#include|#pragma|package|use |import |fn |public class|class |int main)/);
    if (codeStart > 0) return trimmed.substring(codeStart);
    
    return trimmed.length > 0 ? trimmed : null;
}

function generateErrorReport(projectPath: string, files: any[], errors: any[]) {
    let md = `# Synapse Translation Report\n\n`;
    md += `The AI translator encountered errors it could not fix automatically. Please review the following issues in the generated codebase:\n\n`;
    
    errors.forEach((err, i) => {
        md += `## ${i + 1}. File: \`${err.file}\`\n`;
        md += `**Issue:** ${err.issue}\n\n`;
    });

    invoke('save_converted_project', {
        outputDir: `${projectPath}_converted`,
        files: [{ relative_path: 'SYNAPSE_ERROR_REPORT.md', content: md }]
    });
    
    logger.add(`Generated SYNAPSE_ERROR_REPORT.md`, 'UI');
}

function App() {
  const [activeSection, setActiveSection] = useState<Section>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');

  const [activeModel, setActiveModel] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);

  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalErrors, setModalErrors] = useState<any[]>([]);
  const [modalResolver, setModalResolver] = useState<((choice: string) => void) | null>(null);

  const promptUserForAction = (errors: any[]): Promise<string> => {
    return new Promise((resolve) => {
      setModalErrors(errors);
      setModalResolver(() => resolve);
      setShowErrorModal(true);
    });
  };

  const handleUserChoice = (choice: string) => {
    if (modalResolver) modalResolver(choice);
    setShowErrorModal(false);
  };

  const fetchAvailableModels = useCallback(async () => {
    setIsLoadingModels(true);
    const options: ModelOption[] = [];

    const ollamaUrl = localStorage.getItem("synapse_ollama_url") || "http://localhost:11434";

    try {
      const response = await fetch(`${ollamaUrl}/api/tags`);

      if (response.ok) {
        const data = await response.json();

        if (data.models && Array.isArray(data.models)) {
          data.models.forEach((m: { name: string }) => {
            options.push({
              provider: 'local',
              label: `[Local] ${m.name}`,
              value: `ollama:${m.name}`
            });
          });

          logger.add(`Found ${data.models.length} local Ollama models.`, 'UI');
        }
      }
    } catch (err) {
      logger.add(`Ollama offline or not reachable at ${ollamaUrl}.`, 'UI');
    }

    const openaiKey = localStorage.getItem("synapse_openai_key");
    if (openaiKey && openaiKey.trim() !== '') {
      try {
        const openaiResponse = await fetch("https://api.openai.com/v1/models", {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${openaiKey}`
          }
        });

        if (openaiResponse.ok) {
          const openaiData = await openaiResponse.json();
          if (openaiData.data && Array.isArray(openaiData.data)) {
            const chatModels = openaiData.data.filter((m: { id: string }) => 
              m.id.includes("gpt") || m.id.includes("o1") || m.id.includes("o3")
            );

            chatModels.forEach((m: { id: string }) => {
              options.push({
                provider: 'cloud',
                label: `[Cloud] OpenAI: ${m.id}`,
                value: `openai:${m.id}`
              });
            });
            logger.add(`Loaded ${chatModels.length} dynamic models from OpenAI API.`, 'UI');
          }
        } else {
          logger.add("Failed to fetch OpenAI models. Check your API key.", 'UI');
        }
      } catch (err) {
        logger.add("Error connecting to OpenAI API to fetch models.", 'UI');
      }
    }

    const deepseekKey = localStorage.getItem("synapse_deepseek_key");
    if (deepseekKey && deepseekKey.trim() !== '') {
      try {
        const res = await fetch("https://api.deepseek.com/v1/models", {
          headers: { "Authorization": `Bearer ${deepseekKey}` }
        });
        if (res.ok) {
          const data = await res.json();
          const modelsList = data.data || data;
          if (Array.isArray(modelsList)) {
            modelsList.forEach((m: { id: string }) => {
              options.push({ provider: 'cloud', label: `[Cloud] DeepSeek: ${m.id}`, value: `deepseek:${m.id}` });
            });
          }
        } else {
          options.push({ provider: 'cloud', label: '[Cloud] DeepSeek Chat (v3)', value: 'deepseek:deepseek-chat' });
          options.push({ provider: 'cloud', label: '[Cloud] DeepSeek Coder', value: 'deepseek:deepseek-coder' });
        }
      } catch (err) {
        options.push({ provider: 'cloud', label: '[Cloud] DeepSeek Chat (v3)', value: 'deepseek:deepseek-chat' });
      }
    }

    const anthropicKey = localStorage.getItem("synapse_anthropic_key");
    if (anthropicKey && anthropicKey.trim() !== '') {
      try {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: { 
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01"
          }
        });
        if (res.ok) {
          const data = await res.json();
          const modelsList = data.data || data.models || [];
          if (Array.isArray(modelsList)) {
            modelsList.forEach((m: { id: string; name?: string }) => {
              const modelId = m.id;
              options.push({ provider: 'cloud', label: `[Cloud] Claude: ${modelId}`, value: `anthropic:${modelId}` });
            });
          }
        } else {
          options.push({ provider: 'cloud', label: '[Cloud] Claude 3.5 Sonnet', value: 'anthropic:claude-3-5-sonnet-20241022' });
          options.push({ provider: 'cloud', label: '[Cloud] Claude 3.5 Haiku', value: 'anthropic:claude-3-5-haiku-20241022' });
        }
      } catch (err) {
        options.push({ provider: 'cloud', label: '[Cloud] Claude 3.5 Sonnet', value: 'anthropic:claude-3-5-sonnet-20241022' });
      }
    }

    if (options.length === 0) {
      options.push({
        provider: 'local',
        label: 'No models found (Check Ollama or Settings)',
        value: '',
        disabled: true
      });
    }

    setAvailableModels(options);

    if (options.length > 0 && !options[0].disabled) {
      setActiveModel((prev) => {
        const exists = options.some(o => o.value === prev);
        return exists ? prev : options[0].value;
      });
    }

    setIsLoadingModels(false);
  }, []);

  useEffect(() => {
    fetchAvailableModels();
  }, [fetchAvailableModels]);

  useEffect(() => {
    if (activeSection === 'command_center' || activeSection === 'dashboard') {
      fetchAvailableModels();
    }
  }, [activeSection, fetchAvailableModels]);

  const [controlMode, setControlMode] = useState<'translate' | 'modernize'>('translate');
  const [targetLanguage, setTargetLanguage] = useState('Rust (Stable)');
  const [logs, setLogs] = useState(logger.getAllLogs());

  const [projectPath, setProjectPath] = useState<string | null>(null);

  const foldersToIgnore = ['node_modules', 'dist', 'build', '.git', '.vscode'];

  const [nodes, setNodes] = useState<FileNode[]>([]);

  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [graphNodes, setGraphNodes] = useState<any[]>([]);

  const targetStackOptions = [
    'Rust (Stable)',
    'Go',
    'Modern Python 3.12',
    'C++20',
  ];

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };

  const handleModelChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setActiveModel(event.target.value);
    logger.add(`Active model switched to ${event.target.value}`, 'UI');
  };

  const handleScanDirectory = async () => {
    await handleOpenProjectPath();
  };

  const handleExecuteCodeConversion = async () => {
    if (!projectPath) {
      logger.add('Error: No project path selected.', 'UI');
      return;
    }

    if (nodes.length === 0) {
      logger.add('Error: No files found in project.', 'UI');
      return;
    }

    let profileKey = 'cpp20';
    if (targetLanguage.includes('Rust')) profileKey = 'rust';
    else if (targetLanguage.includes('Go')) profileKey = 'go';
    else if (targetLanguage.includes('Python')) profileKey = 'python';

    const profile = LANGUAGE_PROFILES[profileKey] || LANGUAGE_PROFILES['cpp20'];
    logger.add(`[Synapse Core] Selected language profile: ${profile.label} (Header/Source separation: ${profile.usesHeaderSourceSeparation})`, 'UI');

    const plan = buildTranslationPlan(
      nodes.map(n => ({ n: n.id, path: n.path })),
      edges,
      profile,
      projectPath
    );

    logger.add(`[Synapse Core] Plan order: ${plan.map(p => p.sourceRelativePath).join(' -> ')}`, 'UI');

    logger.add(`[Synapse Core] Translation plan built. Total units planned: ${plan.length}`, 'UI');

    const registry = new TranslationRegistry();
    const ollamaUrl = localStorage.getItem("synapse_ollama_url") || "http://localhost:11434";
    let apiKey = "";
    if (activeModel.startsWith("openai:")) apiKey = localStorage.getItem("synapse_openai_key") || "";
    else if (activeModel.startsWith("deepseek:")) apiKey = localStorage.getItem("synapse_deepseek_key") || "";
    else if (activeModel.startsWith("anthropic:")) apiKey = localStorage.getItem("synapse_anthropic_key") || "";

    const convertedFiles: { relative_path: string; content: string }[] = [];

    try {
      for (const unit of plan) {
        try {
          logger.add(`Translating unit: ${unit.sourceRelativePath}...`, 'UI');

          const sourceContent: string = await invoke('read_file_content', {
            filePath: unit.targetFiles[0].sourcePath,
          }).then(res => res as string).catch(() => '// Source content unavailable');

          const actualDeps = new Set<string>(unit.dependencies);
          
          for (const otherUnit of plan) {
            if (otherUnit.id === unit.id) continue;

            const baseName = otherUnit.sourceRelativePath.split(/[/\\]/).pop()?.split('.')[0];
            if (baseName && sourceContent.includes(baseName)) {
              actualDeps.add(otherUnit.id);
            }
          }

          const dependencySignatures = Array.from(actualDeps).map(depId => {
            const entry = registry.getSignatureForUnit(depId);
            if (!entry) return null;
            const primary = extractPrimarySymbol(entry.signature, profile);
            return { symbol: primary ?? depId, targetPath: entry.targetPath, signature: entry.signature };
          }).filter(Boolean) as { symbol: string; targetPath: string; signature: string }[];

          const dependencyHeaders = Array.from(actualDeps)
            .map(depId => registry.getHeaderCode(depId))
            .filter(Boolean)
            .join('\n\n');

          const requiredIncludes = Array.from(actualDeps).map(depId => {
            const depUnit = plan.find(u => u.id === depId);
            if (!depUnit) return null;
            const targetRef = depUnit.targetFiles.find(f => f.role === 'header') ?? depUnit.targetFiles[0];
            return profile.renderDependencyReference(targetRef.targetPath);
          }).filter(Boolean) as string[];

          let generatedHeaderCode = '';

          const headerFile = unit.targetFiles.find(f => f.role === 'header');
          if (headerFile) {
            const headerPrompt = buildFilePrompt(unit, sourceContent, profile, dependencySignatures, headerFile, undefined, dependencyHeaders);
            const headerResponse: string = await invoke('read_and_convert_file', {
              filePath: unit.targetFiles[0].sourcePath, model: activeModel, prompt: headerPrompt, dependencyContext: '', ollamaUrl, apiKey,
            });

            const extractedH = extractEnvelope(headerResponse, headerFile.targetPath, profile);
            if (extractedH) {
              generatedHeaderCode = extractedH;
              let finalH = profile.sanitize(extractedH, 'header', headerFile.targetPath);
              finalH = profile.ensureIncludes(finalH, requiredIncludes, true);
              
              convertedFiles.push({ relative_path: headerFile.targetPath, content: finalH });
              
              const sig = extractSignature(finalH, headerFile, profile);
              registry.register(unit.id, [headerFile], new Map([[headerFile.targetPath, sig]]), finalH);
              logger.add(`Extracted (Pass 1): ${headerFile.targetPath}`, 'UI');
            }
          }

          const sourceFile = unit.targetFiles.find(f => f.role === 'source' || f.role === 'module');
          if (sourceFile) {
            const sourcePrompt = buildFilePrompt(unit, sourceContent, profile, dependencySignatures, sourceFile, generatedHeaderCode || undefined, dependencyHeaders);
            const sourceResponse: string = await invoke('read_and_convert_file', {
              filePath: unit.targetFiles[0].sourcePath, model: activeModel, prompt: sourcePrompt, dependencyContext: '', ollamaUrl, apiKey,
            });

            const extractedCpp = extractEnvelope(sourceResponse, sourceFile.targetPath, profile);
            if (extractedCpp) {
              let finalCpp = profile.sanitize(extractedCpp, 'source', sourceFile.targetPath);
              finalCpp = profile.ensureIncludes(finalCpp, requiredIncludes, false);
              
              convertedFiles.push({ relative_path: sourceFile.targetPath, content: finalCpp });
              
              const sig = extractSignature(finalCpp, sourceFile, profile);
              registry.register(unit.id, [sourceFile], new Map([[sourceFile.targetPath, sig]]));
              logger.add(`Extracted (Pass 2): ${sourceFile.targetPath}`, 'UI');
            }
          }
        } catch (unitError) {
          logger.add(`Failed to translate unit ${unit.id}: ${unitError}`, 'UI');
        }
      }

      if (convertedFiles.length > 0) {
        let qaFinished = false;

        while (!qaFinished) {
          let attempts = 0;
          const isLocalModel = activeModel.startsWith('ollama:');
          const maxAttempts = isLocalModel ? 3 : 1;
          let reviewPassed = false;
          let finalErrors: any[] = [];

          while (attempts < maxAttempts && !reviewPassed) {
            attempts++;
            logger.add(`[QA Phase] Auditing generated code (Attempt ${attempts}/${maxAttempts})...`, 'UI');

            const reviewPrompt = buildReviewPrompt(targetLanguage, convertedFiles);
            const reviewResponse: string = await invoke('read_and_convert_file', {
              filePath: "", model: activeModel, prompt: reviewPrompt, dependencyContext: '', ollamaUrl, apiKey
            });

            try {
              const startIdx = reviewResponse.indexOf('{');
              const endIdx = reviewResponse.lastIndexOf('}');
              
              if (startIdx === -1 || endIdx === -1) {
                throw new Error("No JSON object found in response");
              }

              const jsonStr = reviewResponse.substring(reviewResponse.indexOf('{'), reviewResponse.lastIndexOf('}') + 1);
              const report = JSON.parse(jsonStr);

              if (typeof report.hasErrors !== 'boolean' || !Array.isArray(report.errors)) {
                throw new Error("Invalid JSON schema returned by AI");
              }

              if (!report.hasErrors || report.errors.length === 0) {
                reviewPassed = true;
                logger.add(`[QA Phase] Auditing passed! No errors found.`, 'UI');
                break;
              }

              finalErrors = report.errors;
              logger.add(`[QA Phase] Found ${report.errors.length} errors. Attempting to auto-fix...`, 'UI');

              const fixPrompt = buildFixPrompt(targetLanguage, convertedFiles, report.errors);
              const fixResponse: string = await invoke('read_and_convert_file', {
                filePath: "", model: activeModel, prompt: fixPrompt, dependencyContext: '', ollamaUrl, apiKey
              });

              const fileRegex = /===FILE:\s*(.+?)===\s*(?:```[a-zA-Z0-9+#-]*\r?\n)?([\s\S]*?)(?:```|(?===FILE:)|$)/g;
              let match;
              while ((match = fileRegex.exec(fixResponse)) !== null) {
                const path = match[1].trim();
                const newContent = match[2].replace(/```/g, '').trim();
                const existingFile = convertedFiles.find(f => f.relative_path === path);
                
                if (existingFile) {
                  const isSuspiciouslyShort = newContent.length < (existingFile.content.length * 0.5) && existingFile.content.length > 100;
                  const removedImplementation = existingFile.content.includes('::') && !newContent.includes('::');

                  if (isSuspiciouslyShort || removedImplementation) {
                    logger.add(`[QA Phase] 🛑 Rejected fix for ${path}. The AI tried to delete too much valid code.`, 'UI');
                  } else {
                    existingFile.content = newContent;
                    logger.add(`[QA Phase] Patched file: ${path}`, 'UI');
                  }
                }
              }
            } catch (e) {
              logger.add(`[QA Phase] Failed to parse AI review response. Skipping QA.`, 'UI');
              reviewPassed = true;
              break;
            }
          }

          if (!reviewPassed && finalErrors.length > 0) {
            logger.add(`[QA Phase] Auto-fix failed. Manual intervention required.`, 'UI');

            const userChoice = await promptUserForAction(finalErrors); 
            
            if (userChoice === 'continue') {
              logger.add(`[QA Phase] User chose to continue. Restarting QA loop...`, 'UI');
            } else if (userChoice === 'change_model') {
              logger.add(`[QA Phase] User chose to change model. Please select a new model from the dropdown and run again.`, 'UI');
              qaFinished = true;
            } else if (userChoice === 'keep_as_is') {
              logger.add(`[QA Phase] User chose to keep code as is. Generating report...`, 'UI');
              generateErrorReport(projectPath, convertedFiles, finalErrors);
              qaFinished = true;
            }
          } else {
            qaFinished = true;
          }
        }

        const outputDirectory = `${projectPath}_converted`;
        logger.add(`Saving converted project (${convertedFiles.length} files) to: ${outputDirectory}...`, 'UI');

        const resultMessage: string = await invoke('save_converted_project', {
          outputDir: outputDirectory,
          files: convertedFiles
        });

        logger.add(resultMessage, 'UI');
      } else {
        logger.add('Conversion completed, but no files were successfully generated.', 'UI');
      }
    } catch (error) {
      logger.add(`Batch process error: ${error}`, 'UI');
      console.error(error);
    }
  };

  const scanRecursive = async (path: string, allFiles: string[] = []) => {
    const entries = await readDir(path);

    for (const entry of entries) {
      const fullPath = await join(path, entry.name);

      if (entry.isDirectory && foldersToIgnore.includes(entry.name)) {
        continue;
      }

      if (entry.isDirectory) {
        await scanRecursive(fullPath, allFiles);
      } else {
        allFiles.push(fullPath);
      }
    }

    return allFiles;
  }

  const handleOpenProjectPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select your project folder',
      });

      if (selected) {
        logger.add('Project path selected: ' + selected, 'UI');
        setProjectPath(selected as string);

        const startTime = performance.now();
        const everySingleFile = await scanRecursive(selected as string);
        const endTime = performance.now();

        const COLUMNS = 5;
        const SPACING_X = 180;
        const SPACING_Y = 110;

        const newNodes = everySingleFile.map((filePath, index) => {
          const fileName = filePath.split(`\\`).pop() || filePath.split(`/`).pop() || "";
          const extension = fileName.split(`.`).pop() || "txt";

          const col = index % COLUMNS;
          const row = Math.floor(index / COLUMNS);

          return {
            id: filePath,
            name: fileName,
            path: filePath,
            x: col * SPACING_X + 100,
            y: row * SPACING_Y + 100,
            extension: extension,
          };
        });

        setNodes(newNodes);

        try {
          const projectGraph: any = await invoke('get_project_graph', { projectPath: selected });
          if (projectGraph && projectGraph.edges) {
            if (projectGraph.edges) setEdges(projectGraph.edges);
            if (projectGraph.nodes) setGraphNodes(projectGraph.nodes);
            logger.add(`Loaded graph with ${projectGraph.nodes.length} nodes and ${projectGraph.edges.length} edges.`, "UI");
          }
        } catch (err) {
          logger.add(`Failed to load project graph: ${err}`, "UI");
        }

        logger.add(`Scanned ${everySingleFile.length} files in ${(endTime - startTime).toFixed(2)} ms.`, "UI");
      } else {
        logger.add('Project path selection cancelled', 'UI');
      }
    } catch (error) {
      logger.add('Scan error: ' + error, 'UI');
      console.error(error);
    }
  };

  useEffect(() => {
    const unsubscribe = logger.subscribe(() => setLogs(logger.getAllLogs()));
    return unsubscribe;
  }, []);

  const addTestUiLog = () => {
    const longMessage =
      "UI COMPONENT WARNING: The panel failed to respond to resize constraints because the current layout has exceeded the safe rendering zone. " +
      "Please verify the configuration parameters in the theme engine, ensure that the style buffer is not being overwritten by an external script, " +
      "and confirm that the document flow has enough space to expand vertically while wrapping text dynamically. " +
      "This message exists primarily to validate long-form UI log rendering and color coding behavior in the console viewer.";

    logger.add(longMessage, "UI");
  };

  const clearLogs = () => {
    logger.clear();
    setLogs([]);
  };

  return (
    <main className="container">
      <div className={`sidePanel ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <h2 className="logo">Synapse</h2>
        <button className="pathButton" onClick={handleOpenProjectPath} title={ projectPath || "No path selected " }>
          <span>{ projectPath ? projectPath : "No project path selected" }</span>
        </button>

        <button className={`sidePanelButton ${activeSection === 'command_center' ? 'active' : ''}`} onClick={() => setActiveSection('command_center')}>
          <span>Command Center</span>
        </button>

        <button className={`sidePanelButton ${activeSection === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveSection('dashboard')}>
          <span>Worktable</span>
        </button>

        <button className={`sidePanelButton ${activeSection === 'logs' ? 'active' : ''}`} onClick={() => setActiveSection('logs')}>
          <span>Console Logs</span>
        </button>

        <button className={`sidePanelButton ${activeSection === 'settings' ? 'active' : ''}`} onClick={() => setActiveSection('settings')}>
          <span>Settings</span>
        </button>

        <div className="sidePanelFooter">
          <button className="sidePanelButton small">Sign In</button>
          <button className="sidePanelButton small secondary">Create Account</button>
        </div>
      </div>

      <div className={`mainContent ${isSidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
        <button
          className={`sidebarToggle ${isSidebarCollapsed ? 'collapsed' : ''}`}
          onClick={handleToggleSidebar}
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isSidebarCollapsed ? '›' : '‹'}
        </button>

        {activeSection === 'dashboard' && <div className="dashboard">
          <div className="dashboard-header">
            <div className="dashboard-header-copy">
              <h1>Synapse Worktable</h1>
              <p>Drag anywhere inside the board to pan, and use the mouse wheel to zoom in or out.</p>
            </div>
            <div className="dashboard-header-actions">
              <label className="model-label" htmlFor="model-select">Active model</label>
              <select
                id="model-select"
                className="model-select"
                value={activeModel}
                onChange={handleModelChange}
                disabled={isLoadingModels || availableModels.length === 0 || availableModels[0].disabled}
              >
                {isLoadingModels ? (
                  <option value="">Detecting models...</option>
                ) : (
                  availableModels.map((model) => (
                    <option key={model.value} value={model.value} disabled={model.disabled}>
                      {model.label}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <Worktable nodes={nodes} setNodes={setNodes} edges={edges} />
        </div>}
        {activeSection === 'command_center' && <div className="command-panel">
          <div className="command-panel-grid">
            <button className="command-action-button" onClick={handleScanDirectory}>
              Scan Directory
            </button>
            <button className="command-action-button primary" onClick={handleExecuteCodeConversion}>
              Execute Code Conversion
            </button>
          </div>

          <div className="command-panel-block">
            <label htmlFor="system-prompt">System Prompt Override</label>
            <textarea
              id="system-prompt"
              className="system-prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="Customize the prompt that will be sent to the AI."
            />
          </div>

          <div className="command-panel-footer">
            <div className="segment-toggle">
              <button
                className={`segment-item ${controlMode === 'translate' ? 'active' : ''}`}
                onClick={() => setControlMode('translate')}
              >
                Translate Language
              </button>
              <button
                className={`segment-item ${controlMode === 'modernize' ? 'active' : ''}`}
                onClick={() => setControlMode('modernize')}
              >
                Modernize Version
              </button>
            </div>

            <div className="target-language-select">
              <label htmlFor="target-language">Target stack</label>
              <select
                id="target-language"
                className="model-select"
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
              >
                {targetStackOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
        </div>}
        {activeSection === 'logs' && <div className="console-wrapper">
            <div className="console-header">
              <div className="console-title">Live console stream</div>
              <div className="console-actions">
                <button
                  className="console-action-button"
                  onClick={addTestUiLog}
                  aria-label="Send long UI log"
                >
                  UI log test
                </button>
                <button
                  className="console-clear-button"
                  onClick={clearLogs}
                  aria-label="Delete logs"
                >
                  <span className="button-icon">🗑️</span>
                  <span className="button-tooltip">Delete logs</span>
                </button>
              </div>
            </div>
            <LogViewer logs={logs} />
          </div>}
        {activeSection === 'settings' && <Settings />}
      </div>

      {showErrorModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <span className="modal-icon">⚠️</span>
              <h2>QA Review Failed</h2>
            </div>
            <p className="modal-subtitle">
              The AI could not automatically resolve the following errors after multiple attempts:
            </p>
            <div className="modal-error-list">
              {modalErrors.map((err, i) => (
                <div key={i} className="modal-error-item">
                  <span className="error-file">{err.file}</span>
                  <span className="error-desc">{err.issue}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="modal-btn btn-continue" onClick={() => handleUserChoice('continue')}>
                Try Fixing Again
              </button>
              <button className="modal-btn btn-change" onClick={() => handleUserChoice('change_model')}>
                Change Model
              </button>
              <button className="modal-btn btn-keep" onClick={() => handleUserChoice('keep_as_is')}>
                Keep As Is & Generate Report
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;