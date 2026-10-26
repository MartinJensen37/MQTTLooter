export type Tab = 'logging' | 'publishing' | 'recording' | 'simulation';

export const TAB_LIST: { id: Tab; icon: string; label: string; key: string }[] = [
  { id: 'logging', icon: 'fa-list', label: 'Logging', key: 'F1' },
  { id: 'publishing', icon: 'fa-paper-plane', label: 'Publishing', key: 'F2' },
  { id: 'recording', icon: 'fa-video', label: 'Recording', key: 'F3' },
  { id: 'simulation', icon: 'fa-microchip', label: 'Simulation', key: 'F4' },
];

/** The panel tabs, and the controls for a second pane beside the active one. */
export default function MainTabs({
  activeTab,
  onActiveTabChange,
  splitTab,
  onSplitTabChange,
  pinned,
  onTogglePin,
}: {
  activeTab: Tab;
  onActiveTabChange: (tab: Tab) => void;
  splitTab: Tab | null;
  onSplitTabChange: (tab: Tab | null) => void;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  // Clicking selects without focusing, so F-keys leave no focus ring behind.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();
  return (
    <div className="header-controls">
      <div className="main-tabs">
        {TAB_LIST.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onActiveTabChange(tab.id)}
            onMouseDown={keepFocus}
            className={`tab-btn ${activeTab === tab.id ? 'active' : tab.id === splitTab ? 'secondary' : ''}`}
            title={`${tab.key} - ${tab.label} Panel`}
          >
            <i className={`fas ${tab.icon}`}></i> {tab.label}{' '}
            <span className="shortcut-hint">{tab.key}</span>
          </button>
        ))}
      </div>
      <div className="split-controls">
        {splitTab && (
          <select
            aria-label="Second pane"
            className="custom-select-button form-select form-select-compact"
            value={splitTab}
            onChange={(event) => onSplitTabChange(event.target.value as Tab)}
          >
            {TAB_LIST.filter((tab) => tab.id !== activeTab).map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        )}
        {splitTab && (
          <button
            className={`btn btn-sm ${pinned ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={pinned}
            aria-label="Pin second pane"
            onMouseDown={keepFocus}
            title={
              pinned
                ? 'Let the second pane follow the sidebar again'
                : 'Keep the second pane on this connection and topic'
            }
            onClick={onTogglePin}
          >
            <i className="fas fa-thumbtack"></i> <span className="split-label">Pin</span>
          </button>
        )}
        <button
          className={`btn btn-sm ${splitTab ? 'btn-primary' : 'btn-secondary'}`}
          aria-pressed={Boolean(splitTab)}
          aria-label="Split view"
          onMouseDown={keepFocus}
          title={splitTab ? 'Close split view' : 'Show a second tab beside this one'}
          onClick={() =>
            onSplitTabChange(splitTab ? null : TAB_LIST.find((tab) => tab.id !== activeTab)!.id)
          }
        >
          <i className="fas fa-columns"></i> <span className="split-label">Split</span>
        </button>
      </div>
    </div>
  );
}
