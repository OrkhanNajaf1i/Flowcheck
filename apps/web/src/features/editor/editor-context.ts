import { createContext, useContext } from 'react';

/** Facts about the edited test that deeply nested step fields need. */
export const EditorContext = createContext<{ projectId: string; testCaseId: string } | null>(null);

export function useEditorContext() {
  const value = useContext(EditorContext);
  if (!value) throw new Error('useEditorContext must be used inside the test editor');
  return value;
}
