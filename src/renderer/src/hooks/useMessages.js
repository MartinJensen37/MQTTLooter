import { useState, useRef, useMemo, useCallback } from 'react';
import { MESSAGES } from '../config.js';
import TopicTreeService from '../services/TopicTreeService.js';

export function useMessages(selectedConnection, selectedTopic, connections, showFeedback) {
  const [messages, setMessages] = useState([]);
  const messageBuffer = useRef([]);
  const rafFlushId = useRef(null);

  const handleClearMessages = useCallback((topicPath) => {
    if (!selectedConnection) { showFeedback('No connection selected', 'error'); return; }
    setMessages(prev => prev.filter(m => !(m.connectionId === selectedConnection && m.topic === topicPath)));
    if (typeof TopicTreeService.clearTopicMessages === 'function') {
      TopicTreeService.clearTopicMessages(selectedConnection, topicPath);
    }
    showFeedback('Messages cleared for topic', 'success');
  }, [selectedConnection, showFeedback]);

  const connectionMessages = useMemo(() => {
    if (!selectedConnection || !selectedTopic) return [];
    const conn = connections.find(c => c.id === selectedConnection);
    if (!conn?.isConnected && conn?.status !== 'connected') return [];
    return messages.filter(m => m.connectionId === selectedConnection && m.topic === selectedTopic.topicPath);
  }, [messages, selectedConnection, selectedTopic, connections]);

  const allConnectionMessages = useMemo(() => {
    if (!selectedConnection) return [];
    const conn = connections.find(c => c.id === selectedConnection);
    if (!conn?.isConnected && conn?.status !== 'connected') return [];
    return messages.filter(m => m.connectionId === selectedConnection);
  }, [messages, selectedConnection, connections]);

  return {
    messages, setMessages,
    messageBuffer, rafFlushId,
    connectionMessages, allConnectionMessages,
    handleClearMessages,
  };
}
