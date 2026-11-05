use serde::{Serialize, Deserialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GraphNode {
    pub id: String,
    pub path: String,
    pub file_type: String,
    pub symbols_provided: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub relation: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProjectGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

pub fn analyze_dependencies(project_path: &str) -> Result<ProjectGraph, String> {
    let root_path = Path::new(project_path);
    if !root_path.exists() {
        return Err(format!("Project path does not exist: {}", project_path));
    }

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    visit_dirs(root_path, root_path, &mut nodes)?;

    for i in 0..nodes.len() {
        let source_node = nodes[i].clone();

        let full_path = Path::new(project_path).join(&source_node.path);
        if let Ok(content) = fs::read_to_string(full_path) {
            for j in 0..nodes.len() {
                if i == j { continue; }
                let target_node = nodes[j].clone();
                
                let target_stem = Path::new(&target_node.id)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&target_node.id);
                    
                if content.contains(&target_node.id) || content.contains(target_stem) {
                    edges.push(GraphEdge {
                        from: source_node.id.clone(),
                        to: target_node.id.clone(),
                        relation: "reference".to_string(),
                    });
                }
            }
        }
    }

    Ok(ProjectGraph { nodes, edges })
}

fn visit_dirs(dir: &Path, root: &Path, nodes: &mut Vec<GraphNode>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                if dir_name.starts_with('.') || dir_name == "target" || dir_name == "node_modules" {
                    continue;
                }
            }
            visit_dirs(&path, root, nodes)?;
        } else if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if matches!(ext, "cs" | "rs" | "ts" | "js" | "py") {
                    let file_name = path.file_name().unwrap().to_str().unwrap().to_string();
                    let relative_path = path.strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();

                    let mut symbols = Vec::new();
                    if let Ok(content) = fs::read_to_string(&path) {
                        for line in content.lines() {
                            if line.contains("class ") || line.contains("fn ") || line.contains("public void ") {
                                symbols.push(line.trim().to_string());
                            }
                        }
                    }

                    nodes.push(GraphNode {
                        id: file_name,
                        path: relative_path,
                        file_type: ext.to_string(),
                        symbols_provided: symbols,
                    });
                }
            }
        }
    }

    Ok(())
}