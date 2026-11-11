import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PluginRestartState {
  /** Plugin IDs whose installed files changed and need a backend restart. */
  ids: string[];
  markRestartRequired: (id: string) => void;
  clearRestartRequired: () => void;
}

export const PLUGIN_RESTART_STORAGE_KEY = 'cli-proxy-plugin-restart-required';

/**
 * "Restart required" survives reloads and is shared by the Plugins and Store pages;
 * only the user can clear it because the frontend cannot observe the restart.
 */
export const usePluginRestartStore = create<PluginRestartState>()(
  persist(
    (set) => ({
      ids: [],
      markRestartRequired: (id) =>
        set((state) => (state.ids.includes(id) ? state : { ids: [...state.ids, id] })),
      clearRestartRequired: () => set({ ids: [] }),
    }),
    { name: PLUGIN_RESTART_STORAGE_KEY }
  )
);
