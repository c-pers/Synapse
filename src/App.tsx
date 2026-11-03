import { useEffect, useState, ChangeEvent, useCallback } from "react";
import "./App.css";
import { LogViewer } from "./components/LogViewer";
import { Worktable } from "./components/Worktable";
import { logger } from "./logger";
import { invoke } from '@tauri-apps/api/core';
import { dirname, join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { FileNode } from "./components/types";
import { Settings } from "./components/Settings";

type Section = 'dashboard' | 'logs' | 'settings' | 'command_center';

interface ModelOption {
  provider: 'local' | 'cloud';
  label: string;
  value: string;
  disabled?: boolean;
}

function App() {
  const [activeSection, setActiveSection] = useState<Section>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');

  const [activeModel, setActiveModel] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);

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

    logger.add(`Starting full project conversion for ${nodes.length} files...`, 'UI');

    const ollamaUrl = localStorage.getItem("synapse_ollama_url") || "http://localhost:11434";
    let apiKey = "";
    if (activeModel.startsWith("openai:")) apiKey = localStorage.getItem("synapse_openai_key") || "";
    else if (activeModel.startsWith("deepseek:")) apiKey = localStorage.getItem("synapse_deepseek_key") || "";
    else if (activeModel.startsWith("anthropic:")) apiKey = localStorage.getItem("synapse_anthropic_key") || "";

    let targetExt = "rs";
    if (targetLanguage.includes("Go")) targetExt = "go";
    else if (targetLanguage.includes("Modern Python")) targetExt = "py";
    else if (targetLanguage.includes("C++")) targetExt = "cpp";
    else if (targetLanguage.includes("Rust")) targetExt = "rs";

    const convertedFiles: { relative_path: string; content: string }[] = [];

    try {
      for (const node of nodes) {
        logger.add(`Converting file: ${node.name}...`, 'UI');

        // Chiamiamo Rust passandogli direttamente il percorso: penserà lui a leggerlo e convertirlo!
        const convertedContent: string = await invoke('read_and_convert_file', {
          filePath: node.path,
          model: activeModel,
          prompt: systemPrompt || `You are an expert software developer. Translate or modernize this code targeting: ${targetLanguage}. Mode: ${controlMode}. CRITICAL INSTRUCTION: Output ONLY the raw code wrapped inside a single markdown code block (e.g. \`\`\`cpp ... \`\`\`). Do NOT write any greetings, explanations, descriptions, or notes outside the code block.`,
          ollamaUrl: ollamaUrl,
          apiKey: apiKey
        });

        const baseRelative = node.path.replace(projectPath, '').replace(/^[/\\]/, '');

        const lastDot = baseRelative.lastIndexOf('.');
        const relativePath = lastDot !== -1 
          ? baseRelative.substring(0, lastDot) + '.' + targetExt 
          : baseRelative + '.' + targetExt;

        convertedFiles.push({
          relative_path: relativePath,
          content: convertedContent
        });
      }

      const outputDirectory = `${projectPath}_converted`;
      logger.add(`Saving converted project to: ${outputDirectory}...`, 'UI');

      const resultMessage: string = await invoke('save_converted_project', {
        outputDir: outputDirectory,
        files: convertedFiles
      });

      logger.add(resultMessage, 'UI');

    } catch (error) {
      logger.add(`Project conversion failed: ${error}`, 'UI');
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
          <Worktable nodes={nodes} setNodes={setNodes}/>
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
    </main>
  );
}

export default App;