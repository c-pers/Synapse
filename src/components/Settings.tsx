import { useState, useEffect } from "react";
import { logger } from "../logger";

export function Settings() {
  const [ollamaUrl, setOllamaUrl] = useState(
    localStorage.getItem("synapse_ollama_url") || "http://localhost:11434"
  );
  const [openaiKey, setOpenaiKey] = useState(
    localStorage.getItem("synapse_openai_key") || ""
  );
  const [deepseekKey, setDeepseekKey] = useState(
    localStorage.getItem("synapse_deepseek_key") || ""
  );
  const [anthropicKey, setAnthropicKey] = useState(
    localStorage.getItem("synapse_anthropic_key") || ""
  );

  const handleSave = () => {
    localStorage.setItem("synapse_ollama_url", ollamaUrl);
    localStorage.setItem("synapse_openai_key", openaiKey);
    localStorage.setItem("synapse_deepseek_key", deepseekKey);
    localStorage.setItem("synapse_anthropic_key", anthropicKey);

    logger.add("Settings saved successfully.", "UI");
    alert("Impostazioni salvate con successo!");
  };

  return (
    <div className="settings-container" style={{ padding: "30px", maxWidth: "800px", color: "#f3f4f6" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>Configure Synapse</h1>
      <p style={{ color: "#9ca3af", marginBottom: "30px" }}>
        Manage your local endpoints and cloud API keys for code conversion agents.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Sezione Locale */}
        <div style={{ background: "#111827", padding: "20px", borderRadius: "12px", border: "1px solid #1f2937" }}>
          <h3 style={{ fontSize: "16px", marginBottom: "12px", color: "#60a5fa" }}>Local Provider (Ollama)</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "14px", color: "#9ca3af" }}>Ollama Host URL</label>
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              placeholder="http://localhost:11434"
              style={{
                background: "#1f2937",
                border: "1px solid #374151",
                padding: "10px 14px",
                borderRadius: "8px",
                color: "#fff",
                fontSize: "14px",
                outline: "none"
              }}
            />
          </div>
        </div>

        {/* Sezione Cloud */}
        <div style={{ background: "#111827", padding: "20px", borderRadius: "12px", border: "1px solid #1f2937" }}>
          <h3 style={{ fontSize: "16px", marginBottom: "12px", color: "#34d399" }}>Cloud Providers API Keys</h3>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "14px", color: "#9ca3af" }}>OpenAI API Key (GPT-4o)</label>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                style={{ background: "#1f2937", border: "1px solid #374151", padding: "10px 14px", borderRadius: "8px", color: "#fff", fontSize: "14px", outline: "none" }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "14px", color: "#9ca3af" }}>DeepSeek API Key</label>
              <input
                type="password"
                value={deepseekKey}
                onChange={(e) => setDeepseekKey(e.target.value)}
                placeholder="sk-..."
                style={{ background: "#1f2937", border: "1px solid #374151", padding: "10px 14px", borderRadius: "8px", color: "#fff", fontSize: "14px", outline: "none" }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ fontSize: "14px", color: "#9ca3af" }}>Anthropic API Key (Claude)</label>
              <input
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-..."
                style={{ background: "#1f2937", border: "1px solid #374151", padding: "10px 14px", borderRadius: "8px", color: "#fff", fontSize: "14px", outline: "none" }}
              />
            </div>
          </div>
        </div>

        {/* Pulsante di salvataggio */}
        <div>
          <button
            onClick={handleSave}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              padding: "12px 24px",
              borderRadius: "8px",
              fontWeight: "600",
              cursor: "pointer",
              transition: "background 0.2s"
            }}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}