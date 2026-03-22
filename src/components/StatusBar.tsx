import { Show } from "solid-js";

interface StatusBarProps {
  language: string;
  fileName: string | null;
  line: number;
  column: number;
  errors: number;
  warnings: number;
}

function StatusBar(props: StatusBarProps) {
  return (
    <div class="status-bar">
      <div class="status-left">
        <Show when={props.fileName}>
          <span class="status-item status-language">{props.language}</span>
          <span class="status-item status-filename">{props.fileName}</span>
        </Show>
      </div>
      <div class="status-center">
        <Show when={props.errors > 0 || props.warnings > 0}>
          <Show when={props.errors > 0}>
            <span class="status-item status-errors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              {props.errors}
            </span>
          </Show>
          <Show when={props.warnings > 0}>
            <span class="status-item status-warnings">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {props.warnings}
            </span>
          </Show>
        </Show>
        <Show when={props.errors === 0 && props.warnings === 0 && props.fileName}>
          <span class="status-item status-ok">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            No issues
          </span>
        </Show>
      </div>
      <div class="status-right">
        <Show when={props.fileName}>
          <span class="status-item">Ln {props.line}, Col {props.column}</span>
        </Show>
      </div>
    </div>
  );
}

export default StatusBar;
