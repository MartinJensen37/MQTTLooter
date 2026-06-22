import { useMemo, useCallback, useState, useEffect } from 'react';
import TopicTreeService from '../services/TopicTreeService.js';

/**
 * Hook for message display. Messages are derived from the topic tree's
 * per-node ring buffers instead of a flat array — eliminating the O(n×topics)
 * memory bloat that caused 6.6GB usage on busy brokers.
 */
export function useMessages(selectedConnection, selectedTopic, connections, showFeedback) {
  // Trigger re-render when tree updates (simple counter bump)
  const [updateTick, setUpdateTick] = useState(0);

  // Listen to tree updates — only refresh when the SELECTED topic got messages
  useEffect(() => {
    if (!selectedConnection) return;
    const onTreeUpdate = (data) => {
      if (data.connectionId !== selectedConnection) return;
      // Only rerender if the selected topic was among those that received messages
      if (selectedTopic && data.topics && data.topics.includes(selectedTopic.topicPath)) {
        setUpdateTick(t => t + 1);
      }
    };
    const onTopicCleared = (data) => {
      if (data.connectionId === selectedConnection) {
        setUpdateTick(t => t + 1);
      }
    };
    TopicTreeService.on('treeUpdated', onTreeUpdate);
    TopicTreeService.on('topicMessagesCleared', onTopicCleared);
    return () => {
      TopicTreeService.off('treeUpdated', onTreeUpdate);
      TopicTreeService.off('topicMessagesCleared', onTopicCleared);
    };
  }, [selectedConnection, selectedTopic]);

  const handleClearMessages = useCallback((topicPath) => {
    if (!selectedConnection) { showFeedback('No connection selected', 'error'); return; }
    if (typeof TopicTreeService.clearTopicMessages === 'function') {
      TopicTreeService.clearTopicMessages(selectedConnection, topicPath);
    }
    setUpdateTick(t => t + 1);
    showFeedback('Messages cleared for topic', 'success');
  }, [selectedConnection, showFeedback]);

  /**
   * Messages for the currently selected topic only.
   * Pulled directly from that topic's ring buffer in the tree.
   */
  const connectionMessages = useMemo(() => {
    if (!selectedConnection || !selectedTopic) return [];
    const conn = connections.find(c => c.id === selectedConnection);
    if (!conn?.isConnected && conn?.status !== 'connected') return [];
    // updateTick ensures re-computation when tree updates
    void updateTick;
    const msgs = TopicTreeService.getTopicMessages(selectedConnection, selectedTopic.topicPath);
    return msgs;
  }, [selectedConnection, selectedTopic, connections, updateTick]);

  /**
   * All messages for a connection — used by RecordingPanel.
   * Returns empty for now; RecordingPanel will be updated in a follow-up.
   */
  const allConnectionMessages = useMemo(() => {
    if (!selectedConnection) return [];
    return [];
  }, [selectedConnection]);

  return {
    messages: [], setMessages: () => {},
    messageBuffer: { current: [] }, rafFlushId: { current: null },
    connectionMessages, allConnectionMessages,
    handleClearMessages,
  };
}
