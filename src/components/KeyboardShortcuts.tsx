import { Show, For } from "solid-js";

interface KeyboardShortcutsProps {
  show: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: "Ctrl+S", description: "Save current file", category: "File" },
  { keys: "Ctrl+K Ctrl+S", description: "Show keyboard shortcuts", category: "File" },
  { keys: "Ctrl+Space", description: "Trigger autocomplete", category: "Editor" },
  { keys: "Ctrl+Z", description: "Undo", category: "Editor" },
  { keys: "Ctrl+Shift+Z", description: "Redo", category: "Editor" },
  { keys: "Ctrl+D", description: "Select next occurrence", category: "Editor" },
  { keys: "Ctrl+/", description: "Toggle line comment", category: "Editor" },
  { keys: "Alt+Up/Down", description: "Move line up/down", category: "Editor" },
  { keys: "Ctrl+Shift+K", description: "Delete line", category: "Editor" },
  { keys: "Ctrl+Click", description: "Go to definition", category: "Navigation" },
  { keys: "Ctrl+G", description: "Go to line", category: "Navigation" },
  { keys: "Ctrl+F", description: "Find in file", category: "Navigation" },
  { keys: "Ctrl+H", description: "Find and replace", category: "Navigation" },
];

function KeyboardShortcuts(props: KeyboardShortcutsProps) {
  const categories = ["File", "Editor", "Navigation"];

  return (
    <Show when={props.show}>
      <div class="shortcuts-backdrop" onClick={props.onClose} />
      <div class="shortcuts-panel">
        <div class="shortcuts-header">
          <h2 class="shortcuts-title">Keyboard Shortcuts</h2>
          <button class="shortcuts-close" onClick={props.onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="shortcuts-body">
          <For each={categories}>
            {(cat) => (
              <div class="shortcuts-category">
                <h3 class="shortcuts-category-title">{cat}</h3>
                <For each={SHORTCUTS.filter(s => s.category === cat)}>
                  {(shortcut) => (
                    <div class="shortcuts-row">
                      <span class="shortcuts-desc">{shortcut.description}</span>
                      <kbd class="shortcuts-kbd">{shortcut.keys}</kbd>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

export default KeyboardShortcuts;
