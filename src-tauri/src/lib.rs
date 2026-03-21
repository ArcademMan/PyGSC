use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileEntry>>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppConfig {
    theme: String,
    last_project: Option<String>,
    last_file: Option<String>,
    #[serde(default)]
    open_tabs: Vec<String>,
    #[serde(default = "default_sidebar_width")]
    sidebar_width: f64,
    #[serde(default = "default_editor_split")]
    editor_split: f64,
    #[serde(default)]
    expanded_dirs: Vec<String>,
}

fn default_sidebar_width() -> f64 { 260.0 }
fn default_editor_split() -> f64 { 50.0 }

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "steam-dark".to_string(),
            last_project: None,
            last_file: None,
            open_tabs: Vec::new(),
            sidebar_width: 260.0,
            editor_split: 50.0,
            expanded_dirs: Vec::new(),
        }
    }
}

fn config_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let dir = PathBuf::from(appdata).join("AmMstools").join("pygsc");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn config_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

fn custom_api_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("custom-api.json"))
}

fn custom_usings_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("custom-usings.json"))
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    let path = config_path()?;
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_custom_api() -> Result<String, String> {
    let path = custom_api_path()?;
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_custom_api(data: String) -> Result<(), String> {
    let path = custom_api_path()?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_custom_usings() -> Result<String, String> {
    let path = custom_usings_path()?;
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_custom_usings(data: String) -> Result<(), String> {
    let path = custom_usings_path()?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    read_dir_recursive(Path::new(&path), 0, 5)
}

fn read_dir_recursive(path: &Path, depth: usize, max_depth: usize) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut result: Vec<FileEntry> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path();
        let is_dir = file_path.is_dir();

        if file_name.starts_with('.') || file_name == "__pycache__" || file_name == "node_modules" {
            continue;
        }

        let children = if is_dir && depth < max_depth {
            Some(read_dir_recursive(&file_path, depth + 1, max_depth).unwrap_or_default())
        } else if is_dir {
            Some(Vec::new())
        } else {
            None
        };

        result.push(FileEntry {
            name: file_name,
            path: file_path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("File already exists".to_string());
    }
    fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("Directory already exists".to_string());
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_path(src: String, dest: String) -> Result<(), String> {
    let src_path = Path::new(&src);
    let dest_path = Path::new(&dest);
    if src_path.is_dir() {
        copy_dir_recursive(src_path, dest_path)
    } else {
        fs::copy(src_path, dest_path).map(|_| ()).map_err(|e| e.to_string())
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_child = entry.path();
        let dest_child = dest.join(entry.file_name());
        if src_child.is_dir() {
            copy_dir_recursive(&src_child, &dest_child)?;
        } else {
            fs::copy(&src_child, &dest_child).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_directory, read_file, write_file,
            create_file, create_directory, delete_path, rename_path, copy_path,
            load_config, save_config,
            load_custom_api, save_custom_api, load_custom_usings, save_custom_usings
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
