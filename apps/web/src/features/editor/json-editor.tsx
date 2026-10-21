import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';

// Monaco is bundled locally; @monaco-editor/react would otherwise load it from a CDN.
self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};
loader.config({ monaco });

/** Lazily loaded (large) JSON editor for the "Advanced: JSON" tab. */
export default function JsonEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="h-[520px] overflow-hidden rounded-md border border-border">
      <Editor
        language="json"
        value={value}
        onChange={(next) => onChange(next ?? '')}
        options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, tabSize: 2 }}
      />
    </div>
  );
}
