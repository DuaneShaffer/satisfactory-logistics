import { createContext, useContext } from 'react';

/** Set of currently selected node IDs. Empty set = nothing selected. */
export const SelectionContext = createContext<Set<string>>(new Set());

export const useSelectedNodeIds = () => useContext(SelectionContext);
