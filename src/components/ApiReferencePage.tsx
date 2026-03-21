import { createSignal, createEffect, Show, For } from "solid-js";
import { getBo3Api, getApiData, type Bo3Function } from "../lib/transpiler";

interface ApiReferencePageProps {
  initialSearch: string;
}

type ApiTab = "bo3" | "pygsc";

function ApiReferencePage(props: ApiReferencePageProps) {
  const [search, setSearch] = createSignal("");
  const [activeTab, setActiveTab] = createSignal<ApiTab>("bo3");
  const [selectedFn, setSelectedFn] = createSignal<string | null>(null);
  const [sideFilter, setSideFilter] = createSignal<"all" | "server" | "client">("all");

  // Sync initial search from parent
  createEffect(() => {
    const s = props.initialSearch;
    if (s) {
      setSearch(s);
      setSelectedFn(s);
      setActiveTab("bo3");
    }
  });

  const bo3Data = getBo3Api();
  const pygscData = getApiData();

  function filteredBo3(): [string, Bo3Function][] {
    const s = search().toLowerCase();
    const side = sideFilter();
    return Object.entries(bo3Data).filter(([name, info]) => {
      if (s && !name.toLowerCase().includes(s) && !(info.summary && info.summary.toLowerCase().includes(s))) return false;
      if (side !== "all" && info.side?.toLowerCase() !== side) return false;
      return true;
    });
  }

  function filteredPygsc(): [string, string, { translation: string; summary?: string; fullAPI?: string; example?: string; [k: string]: string | undefined }][] {
    const s = search().toLowerCase();
    const results: [string, string, any][] = [];
    for (const [category, entries] of Object.entries(pygscData)) {
      for (const [key, val] of Object.entries(entries)) {
        if (!s || key.toLowerCase().includes(s) || (val.summary && val.summary.toLowerCase().includes(s))) {
          results.push([category, key, val]);
        }
      }
    }
    return results;
  }

  function selectedBo3Info(): Bo3Function | null {
    const name = selectedFn();
    if (!name || !bo3Data[name]) return null;
    return bo3Data[name];
  }

  function getMandatoryParams(info: Bo3Function): string[] {
    const params: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const key = `mandatory${i}`;
      if (info[key]) params.push(info[key]!);
      else break;
    }
    return params;
  }

  function getOptionalParams(info: Bo3Function): string[] {
    const params: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const key = `optional${i}`;
      if (info[key]) params.push(info[key]!);
      else break;
    }
    return params;
  }

  return (
    <div class="api-ref-page">
      {/* Header */}
      <div class="api-ref-header">
        <div class="api-ref-tabs">
          <button class={`api-ref-tab ${activeTab() === "bo3" ? "active" : ""}`} onClick={() => setActiveTab("bo3")}>
            BO3 Engine <span class="api-ref-tab-count">{Object.keys(bo3Data).length}</span>
          </button>
          <button class={`api-ref-tab ${activeTab() === "pygsc" ? "active" : ""}`} onClick={() => setActiveTab("pygsc")}>
            PyGSC API
          </button>
        </div>
        <div class="api-ref-controls">
          <input
            class="api-ref-search"
            placeholder="Search functions..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <Show when={activeTab() === "bo3"}>
            <select class="api-ref-filter" value={sideFilter()} onChange={(e) => setSideFilter(e.currentTarget.value as any)}>
              <option value="all">All</option>
              <option value="server">Server</option>
              <option value="client">Client</option>
            </select>
          </Show>
        </div>
      </div>

      {/* Content */}
      <div class="api-ref-content">
        {/* BO3 Tab */}
        <Show when={activeTab() === "bo3"}>
          <div class="api-ref-split">
            {/* Function List */}
            <div class="api-ref-list">
              <div class="api-ref-list-header">
                <span>{filteredBo3().length} functions</span>
              </div>
              <div class="api-ref-list-scroll">
                <For each={filteredBo3()}>
                  {([name, info]) => (
                    <div
                      class={`api-ref-list-item ${selectedFn() === name ? "selected" : ""}`}
                      onClick={() => setSelectedFn(name)}
                    >
                      <span class="api-ref-fn-name">{name}</span>
                      <Show when={info.side}>
                        <span class={`api-badge ${info.side?.toLowerCase()}`}>{info.side}</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>

            {/* Detail Panel */}
            <div class="api-ref-detail">
              <Show when={!selectedBo3Info()}>
                <div class="api-ref-empty">Select a function to view details</div>
              </Show>
              <Show when={selectedBo3Info()}>
                <div class="api-ref-detail-content">
                  <div class="api-ref-detail-title">
                    <h2>{selectedFn()}</h2>
                    <Show when={selectedBo3Info()!.side}>
                      <span class={`api-badge large ${selectedBo3Info()!.side?.toLowerCase()}`}>{selectedBo3Info()!.side}</span>
                    </Show>
                  </div>

                  <div class="api-ref-signature-block">
                    <Show when={selectedBo3Info()!.callOn}>
                      <span class="api-ref-callon">{selectedBo3Info()!.callOn} </span>
                    </Show>
                    <span class="api-ref-sig">{selectedBo3Info()!.fullAPI}</span>
                  </div>

                  <Show when={selectedBo3Info()!.summary}>
                    <div class="api-ref-section">
                      <h3>Description</h3>
                      <p>{selectedBo3Info()!.summary}</p>
                    </div>
                  </Show>

                  <Show when={getMandatoryParams(selectedBo3Info()!).length > 0}>
                    <div class="api-ref-section">
                      <h3>Required Parameters</h3>
                      <For each={getMandatoryParams(selectedBo3Info()!)}>
                        {(param) => (
                          <div class="api-ref-param mandatory">
                            <span class="param-badge req">REQ</span>
                            <span>{param}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={getOptionalParams(selectedBo3Info()!).length > 0}>
                    <div class="api-ref-section">
                      <h3>Optional Parameters</h3>
                      <For each={getOptionalParams(selectedBo3Info()!)}>
                        {(param) => (
                          <div class="api-ref-param optional">
                            <span class="param-badge opt">OPT</span>
                            <span>{param}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={selectedBo3Info()!.example}>
                    <div class="api-ref-section">
                      <h3>Example</h3>
                      <pre class="api-ref-code">{selectedBo3Info()!.example}</pre>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        {/* PyGSC Tab */}
        <Show when={activeTab() === "pygsc"}>
          <div class="api-ref-pygsc-list">
            <For each={filteredPygsc()}>
              {([category, key, val]) => (
                <div class="api-ref-pygsc-item">
                  <span class="api-ref-pygsc-cat">{category}</span>
                  <div class="api-ref-pygsc-main">
                    <span class="api-ref-pygsc-key">{key}</span>
                    <span class="api-ref-pygsc-arrow">{"\u2192"}</span>
                    <span class="api-ref-pygsc-translation">{val.translation}</span>
                  </div>
                  <Show when={val.summary}>
                    <div class="api-ref-pygsc-summary">{val.summary}</div>
                  </Show>
                  <Show when={val.example}>
                    <pre class="api-ref-pygsc-example">{val.example}</pre>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

export default ApiReferencePage;
