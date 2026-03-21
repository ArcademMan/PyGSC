import * as monaco from "monaco-editor";
import { getBo3Api } from "../../lib/transpiler";
import {
  referenceProvider,
  documentSymbolProvider,
  signatureHelpProvider,
  codeLensProvider,
} from "../../lib/language-service";
import { getPygscTokensProvider, getPygscLanguageConfig } from "./pygsc-language";
import { getGscTokensProvider, getGscLanguageConfig } from "./gsc-language";
import { getPygscTheme, getGscTheme } from "./editor-themes";
import { createCompletionProvider } from "./autocomplete";
import { createHoverProvider } from "./hover";

// Persist disposables on window so they survive HMR module re-execution
const _win = window as unknown as {
  __pygscDisposables?: monaco.IDisposable[];
  __pygscLangRegistered?: boolean;
  __gscLangRegistered?: boolean;
};
if (!_win.__pygscDisposables) _win.__pygscDisposables = [];

export function registerLanguages() {
  // Dispose previous registrations (handles HMR re-execution)
  for (const d of _win.__pygscDisposables!) d.dispose();
  _win.__pygscDisposables!.length = 0;

  // Only register the language id once (cannot be undone)
  if (!_win.__pygscLangRegistered) {
    _win.__pygscLangRegistered = true;
    monaco.languages.register({ id: "pygsc" });
  }

  // Build BO3 API names list for the tokenizer
  const bo3Names = Object.keys(getBo3Api());

  // PyGSC language
  _win.__pygscDisposables!.push(
    monaco.languages.setMonarchTokensProvider("pygsc", getPygscTokensProvider(bo3Names))
  );
  monaco.languages.setLanguageConfiguration("pygsc", getPygscLanguageConfig(monaco));
  monaco.editor.defineTheme("pygsc-dark", getPygscTheme());

  // GSC language
  if (!_win.__gscLangRegistered) {
    _win.__gscLangRegistered = true;
    monaco.languages.register({ id: "gsc" });
  }
  monaco.languages.setMonarchTokensProvider("gsc", getGscTokensProvider(bo3Names));
  monaco.languages.setLanguageConfiguration("gsc", getGscLanguageConfig());
  monaco.editor.defineTheme("gsc-dark", getGscTheme());

  // Providers
  _win.__pygscDisposables!.push(
    monaco.languages.registerCompletionItemProvider("pygsc", createCompletionProvider())
  );
  _win.__pygscDisposables!.push(
    monaco.languages.registerHoverProvider("pygsc", createHoverProvider())
  );
  _win.__pygscDisposables!.push(
    monaco.languages.registerReferenceProvider("pygsc", referenceProvider)
  );
  _win.__pygscDisposables!.push(
    monaco.languages.registerDocumentSymbolProvider("pygsc", documentSymbolProvider)
  );
  _win.__pygscDisposables!.push(
    monaco.languages.registerSignatureHelpProvider("pygsc", signatureHelpProvider)
  );
  _win.__pygscDisposables!.push(
    monaco.languages.registerCodeLensProvider("pygsc", codeLensProvider)
  );
}
