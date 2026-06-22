import { useMemo, useCallback, useState, useEffect } from 'react';
import TopicTreeService from '../services/TopicTreeService';

type ShowFeedback = (message: string, type?: string) => void;

interface SelectedTopic {
  topicPath: string;
  [key: string]: unknown;
}

interface ConnectionLike {
  id: string;
  isConnected?: boolean;
  status?: string;
}

/**
 * Message display hook. Messages are derived from the topic tree's per-node ring
 * buffers rather than a flat array — avoiding the O(n×topics) memory bloat that
 * caused 6.6GB usage on busy brokers.
 */
export function useMessages(
  selectedConnection: string | null,
  selectedTopic: SelectedTopic | null,
  connections: ConnectionLike[],
  showFeedback: ShowFeedback,
) {
  // Counter bump to re-render when the tree updates.
  const [updateTick, setUpdateTick] = useState(0);

  // Re-render only when the SELECTED topic received messages.
  useEffect(() => {
    if (!selectedConnection) return;
    const onTreeUpdate = (data: any) => {
      if (data.connectionId !== selectedConnection) return;
      if (selectedTopic && data.topics && data.topics.includes(selectedTopic.topicPath)) {
        setUpdateTick((t) => t + 1);
      }
    };
    const onTopicCleared = (data: any) => {
      if (data.connectionId === selectedConnection) setUpdateTick((t) => t + 1);
    };
    TopicTreeService.on('treeUpdated', onTreeUpdate);
    TopicTreeService.on('topicMessagesCleared', onTopicCleared);
    return () => {
      TopicTreeService.off('treeUpdated', onTreeUpdate);
      TopicTreeService.off('topicMessagesCleared', onTopicCleared);
    };
  }, [selectedConnection, selectedTopic]);

  const handleClearMessages = useCallback(
    (topicPath: string) => {
      if (!selectedConnection) {
        showFeedback('No connection selected', 'error');
        return;
      }
      TopicTreeService.clearTopicMessages(selectedConnection, topicPath);
      setUpdateTick((t) => t + 1);
      showFeedback('Messages cleared for topic', 'success');
    },
    [selectedConnection, showFeedback],
  );

  // Messages for the currently selected topic, pulled from its ring buffer.
  const connectionMessages = useMemo(() => {
    if (!selectedConnection || !selectedTopic) return [];
    const conn = connections.find((c) => c.id === selectedConnection);
    if (!conn?.isConnected && conn?.status !== 'connected') return [];
    void updateTick; // re-compute when the tree updates
    return TopicTreeService.getTopicMessages(selectedConnection, selectedTopic.topicPath);
  }, [selectedConnection, selectedTopic, connections, updateTick]);

  // RecordingPanel still reads this; it stays empty until that panel is migrated
  // to the ring-buffer source (tracked in Phase 3/4).
  const allConnectionMessages = useMemo(() => [], []);

  return {
    connectionMessages,
    allConnectionMessages,
    handleClearMessages,
  };
}
