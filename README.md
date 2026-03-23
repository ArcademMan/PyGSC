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
    if $players.size > 0:
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

### Two modes, one IDE

- **PyGSC mode** — Write scripts in Pseudo-Python syntax and see the transpiled GSC output in real time on a split editor
- **GSC-only mode** — Don't need PyGSC? Use the editor as a full GSC/CSC IDE with all the features below, no transpilation involved

### Smart editor

- **IntelliSense** — Full autocomplete for BO3 engine functions and PyGSC shortcuts, with hover tooltips showing signatures, parameters, and descriptions
- **Go-to-definition & find references** — `Ctrl+Click` to jump to any function definition across your project, find all usages of a symbol
- **Real-time linting** — Catches errors as you type: missing `wait` in infinite loops, undefined variables, wrong parameter counts, unbalanced braces, `waittill`/`endon` mismatches, and more — works in both PyGSC and GSC mode
- **BO3 API reference** — Searchable database of 2000+ engine functions built into the sidebar

### PyGSC syntax

- **Python-like constructs** — `def`, `import`, `#` comments, `and`/`or`/`not`, `True`/`False`/`None`
- **Syntax sugar** — `@endon`/`@system` decorators, `repeat`/`every`/`on`/`once`/`chance` blocks, f-string interpolation
- **700+ shortcuts** — Write `print` instead of `IPrintLnBold`, `$players` instead of `GetPlayers()`, `givepoints` instead of `zm_score::add_to_player_score`, and hundreds more
- **Reverse transpilation** — Import existing GSC files and convert them back to PyGSC

### Everything else

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
