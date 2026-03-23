<p align="center">
  <img src="assets/icon.png" alt="PyGSC Logo" width="120" />
</p>

<h1 align="center">PyGSC</h1>

<p align="center">
  A desktop IDE for transpiling Pseudo-Python into GSC/CSC for Call of Duty: Black Ops III Zombies modding.
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#installation">Installation</a> &middot;
  <a href="#development">Development</a> &middot;
  <a href="#usage">Usage</a> &middot;
  <a href="#license">License</a>
</p>

---

## What is PyGSC?

PyGSC lets you write BO3 scripts using a Python-like syntax and transpiles them into valid GSC/CSC in real time. It also supports editing raw GSC files directly with linting, autocomplete, and API reference built in.

**Example** — PyGSC on the left, generated GSC on the right:

```python
# PyGSC
fname mymod
import scripts\zm\_zm_score

def welcome_players():
    foreach player in $players:
        player print("Welcome!")
        player givepoints(500)

every 5:
    if $players.size greater 0:
        thr welcome_players()
```

```c
// Generated GSC
#namespace mymod;
#using scripts\zm\_zm_score;

function welcome_players() {
    foreach (player in GetPlayers()) {
        player IPrintLnBold("Welcome!");
        player zm_score::add_to_player_score(500);
    }
}

while (true) {
    wait 5;
    if (GetPlayers().size > 0) {
        thread welcome_players();
    }
}
```

## Features

- **Real-time transpilation** — Write PyGSC, see GSC output instantly in a split editor
- **Reverse transpilation** — Import existing GSC files and convert them to PyGSC
- **GSC-only mode** — Edit raw GSC/CSC files with full editor support
- **Syntax sugar** — `@endon`, `@system` decorators, `repeat`/`every` loops, f-string interpolation, `and`/`or`/`not` operators
- **IntelliSense** — Autocomplete, hover tooltips, go-to-definition, find references across your project
- **Linting** — Real-time diagnostics for both PyGSC and GSC (missing waits, undefined variables, brace balancing, parameter counts, and more)
- **BO3 API reference** — Searchable database of 2000+ engine functions with signatures and descriptions
- **Project management** — File explorer, multi-tab editing, unsaved change tracking
- **Themes** — Steam Dark, Midnight, Nord, Monokai, Dracula
- **Custom API/Usings** — Define your own PyGSC keywords and namespace mappings

## Installation

Download the latest release for your platform from the [Releases](../../releases) page.

### Supported platforms

| Platform | Format |
|----------|--------|
| Windows  | `.msi` / `.exe` |
| macOS    | `.dmg` |
| Linux    | `.deb` / `.AppImage` |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (1.77.2+)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
# Clone the repository
git clone https://github.com/ArcademMen/pygsc.git
cd pygsc

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Usage

### Getting started

1. Open PyGSC and click **Open Project** to load your BO3 mod folder
2. Create or open a `.pygsc` file to start writing in Pseudo-Python
3. The GSC output updates in real time in the right panel
4. Press **Ctrl+S** to save — the transpiled GSC is written alongside your source file

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save current file |
| `Ctrl+K Ctrl+S` | Show keyboard shortcuts |
| `Ctrl+Space` | Trigger autocomplete |
| `Ctrl+Click` | Go to definition |
| `Ctrl+G` | Go to line |
| `Ctrl+F` | Find in file |
| `Ctrl+H` | Find and replace |
| `Alt+Up/Down` | Move line up/down |

### GSC-only mode

Toggle GSC-only mode from the sidebar to edit `.gsc` and `.csc` files directly with linting and autocomplete — no transpilation needed.

## Tech stack

- **Frontend** — [SolidJS](https://www.solidjs.com/) + [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- **Backend** — [Tauri](https://v2.tauri.app/) (Rust)
- **Build** — [Vite](https://vite.dev/) + TypeScript

## License

[MIT](LICENSE) &copy; 2026 ArcademMen
