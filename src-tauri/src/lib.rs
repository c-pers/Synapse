use std::fs;
use std::path::Path;
use reqwest::Client;
use serde::Deserialize;

#[derive(serde::Serialize)]
struct FileAnalysis {
    lines: usize,
    size_bytes: u64,
    message: String,
}

#[tauri::command]
fn analyze_file(path: String) -> Result<FileAnalysis, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let size_bytes = metadata.len();

    match fs::read_to_string(&path) {
        Ok(content) => {
            let lines = content.lines().count();
            Ok(FileAnalysis {
                lines,
                size_bytes,
                message: format!("Analysis complete."),
            })
        }
        Err(e) => {
            Ok(FileAnalysis {
                lines: 0,
                size_bytes,
                message: format!("Binary or unreadable text file format."),
            })
        }
    }
}

#[derive(Deserialize)]
pub struct ConversionPayload {
    model: String,
    prompt: String,
    file_content: String,
    ollama_url: Option<String>,
    api_key: Option<String>,
}

#[tauri::command]
async fn execute_code_conversion(payload: ConversionPayload) -> Result<String, String> {
    let client = Client::new();

    let parts: Vec<&str> = payload.model.splitn(2, ':').collect();
    
    if parts.len() < 2 {
        return Err("Invalid model format specified.".into());
    }

    let provider = parts[0];
    let model_name = parts[1];

    match provider {
        "ollama" => {
            let base_url = payload.ollama_url.unwrap_or_else(|| "http://localhost:11434".to_string());
            let endpoint = format!("{}/api/generate", base_url);

            let body = serde_json::json!({
                "model": model_name,
                "prompt": format!("{}\n\nCode/Context:\n{}", payload.prompt, payload.file_content),
                "stream": false
            });

            let res = client.post(&endpoint)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

            if !res.status().is_success() {
                return Err(format!("Ollama error status: {}", res.status()));
            }

            let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            let response_text = json["response"].as_str().unwrap_or("No response generated").to_string();
            Ok(response_text)
        },
        "openai" => {
            let api_key = payload.api_key.ok_or("Missing OpenAI API Key")?;
            let endpoint = "https://api.openai.com/v1/chat/completions";

            let body = serde_json::json!({
                "model": model_name,
                "messages": [
                    {"role": "system", "content": payload.prompt},
                    {"role": "user", "content": payload.file_content}
                ]
            });

            let res = client.post(endpoint)
                .bearer_auth(api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("OpenAI request failed: {}", e))?;

            let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            let content = json["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("No content received")
                .to_string();
            Ok(content)
        },
        _ => Err(format!("Unsupported provider: {}", provider))
    }
}

#[derive(Deserialize)]
pub struct ConvertedFilePayload {
    relative_path: String,
    content: String,
}

#[tauri::command]
fn save_converted_project(output_dir: String, files: Vec<ConvertedFilePayload>) -> Result<String, String> {
    let base_output_path = Path::new(&output_dir);

    for file in files {
        let target_path = base_output_path.join(&file.relative_path);

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }

        fs::write(&target_path, file.content)
            .map_err(|e| format!("Failed to write file {:?}: {}", target_path, e))?;
    }

    Ok(format!("Successfully generated converted project at: {}", output_dir))
}

#[tauri::command]
async fn read_and_convert_file(
    file_path: String,
    model: String,
    prompt: String,
    ollama_url: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let file_content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file at {}: {}", file_path, e))?;

    let client = Client::new();
    let mut parts = model.splitn(2, ':');
    let provider = parts.next().ok_or("Invalid model format specified.")?;
    let model_name = parts.next().ok_or("Missing model name specified.")?;

    fn clean_ai_response(response: &str) -> String {
        if let Some(start) = response.find("```") {
            let rest = &response[start + 3..];
            if let Some(newline) = rest.find('\n') {
                let code_content = &rest[newline + 1..];
                if let Some(end) = code_content.rfind("```") {
                    return code_content[..end].trim().to_string();
                }
            }
        }
        
        // Fallback: se l'IA non ha usato i backtick, restituisce il testo ripulito ma segnala/prova a tenere
        response.trim().to_string()
    }

    match provider {
        "ollama" => {
            let base_url = ollama_url.unwrap_or_else(|| "http://localhost:11434".to_string());
            let endpoint = format!("{}/api/generate", base_url);

            let body = serde_json::json!({
                "model": model_name,
                "prompt": format!("{}\n\nCode/Context:\n{}", prompt, file_content),
                "stream": false
            });

            let res = client.post(&endpoint)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

            if !res.status().is_success() {
                return Err(format!("Ollama error status: {}", res.status()));
            }

            let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            let response_text = clean_ai_response(json["response"].as_str().unwrap_or(""));
            Ok(response_text)
        },
        "openai" => {
            let api_key = api_key.ok_or("Missing OpenAI API Key")?;
            let endpoint = "https://api.openai.com/v1/chat/completions";

            let body = serde_json::json!({
                "model": model_name,
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": file_content}
                ]
            });

            let res = client.post(endpoint)
                .bearer_auth(api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("OpenAI request failed: {}", e))?;

            let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            let content = clean_ai_response(json["choices"][0]["message"]["content"].as_str().unwrap_or(""));
            Ok(content)
        },
        _ => Err(format!("Unsupported provider: {}", provider))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            analyze_file,
            execute_code_conversion,
            save_converted_project,
            read_and_convert_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}