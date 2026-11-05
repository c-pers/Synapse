# Synapse ⚡

**Synapse** is a modern, Tauri-based IDE designed for local and cloud-assisted code modernization, translation, and refactoring.

## 🚀 Features

- **Hybrid AI Integration**: Connect to local models via **Ollama** or cloud providers (**OpenAI**, **DeepSeek**, **Anthropic**).
- **Secure Rust Backend**: File system operations, network requests, and response parsing are handled natively in Rust for maximum performance and security.
- **Smart Code Cleaning**: Automatically strips conversational AI filler text, isolating pure, executable code blocks.
- **Project-Wide Modernization**: Scans project structures and replicates them into a clean `_converted` directory with updated file extensions matching your target stack.

## 🛠️ Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS
- **Backend**: Rust, Tauri v2, Reqwest, Serde

## ⚙️ Getting Started

### Prerequisites
Before you begin, ensure you have the following installed:
1. **Node.js** (v18 or higher)
2. **Rust & Cargo** (Install via [rustup](https://rustup.rs/))
3. **System Dependencies**: Follow the [Tauri setup guide](https://tauri.app/v1/guides/getting-started/prerequisites) for your specific OS (Windows, macOS, or Linux).
4. **Ollama**: Synapse uses local AI models. [Download Ollama here](https://ollama.com/).
   * After installing Ollama, pull a recommended model (e.g., `qwen2.5-coder:7b` or `llama3`):
     ```bash
     ollama run qwen2.5-coder:7b

### Installation & Run

1. Clone the repository:
   ```bash
   git clone https://github.com/c-pers/Synapse.git
   cd Synapse

2. Install dependencies:
   ```bash
   npm install

3. Run in development mode (Tauri):
   ```bash
   npm run tauri dev
