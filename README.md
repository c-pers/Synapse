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

1. Clone the repository:
   ```bash
   git clone [https://github.com/c-pers/Synapse.git](https://github.com/c-pers/Synapse.git)
   cd Synapse

2. Install dependencies:
   ```bash
   npm install

3. Run in development mode (Tauri):
   ```bash
   npm run tauri dev

