import type { RunStatus } from '@flowcheck/shared';
import { create } from 'zustand';

/** Client-only UI state. Server data never lives here (that is TanStack Query's job). */
interface UiState {
  testNameFilter: string;
  testResultFilter: RunStatus | 'never' | 'any';
  showArchived: boolean;
  setTestNameFilter: (value: string) => void;
  setTestResultFilter: (value: UiState['testResultFilter']) => void;
  setShowArchived: (value: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  testNameFilter: '',
  testResultFilter: 'any',
  showArchived: false,
  setTestNameFilter: (testNameFilter) => set({ testNameFilter }),
  setTestResultFilter: (testResultFilter) => set({ testResultFilter }),
  setShowArchived: (showArchived) => set({ showArchived }),
}));
